import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { askEvals, listEvalOperations } from "./ask-evals.ts";
import { createError } from "./errors.ts";
import { readJson } from "./read-json.ts";
import { getClosest } from "./get-closest.ts";
import { getSchemaPath } from "./get-schema-path.ts";
import type { Mock, MockContext, ToolResult } from "./types.ts";

/**
 * The official MCP inspector, run through npx at pull time. It implements the
 * OAuth sign-in hosted MCP servers require (browser flow, token stored in
 * `~/.mcp-inspector`), which the SDK client leaves to its caller.
 * See https://github.com/modelcontextprotocol/inspector
 */
const INSPECTOR = "@modelcontextprotocol/inspector";

/** The inspector's lint summary on stderr: `Schema portability: 0 errors, 24 warnings across 10 tools.` */
const LINT_SUMMARY = /Schema portability: (\d+) errors?, (\d+) warnings?/;

/** A tool as `tools/list` returns it. The model reads all three fields. */
type Tool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
};

/**
 * Mock a hosted MCP server from its pulled `tools/list` and a result per
 * tool. The schema file is `schemas/<mock>.json`, which
 * `eve-mocks pull` writes.
 *
 * The file carries the real names, descriptions, and input schemas, because the
 * model reads them: a paraphrased description makes an eval test a different
 * prompt than production.
 *
 * Stateless like the hosted servers: eve's MCP client calls tools without an
 * `mcp-session-id`, which a session-checking server rejects with HTTP 400.
 * Stateless mode needs a fresh server and transport per request.
 * See https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
 *
 * @param input.url - Production MCP endpoint to intercept, and what
 *   `eve-mocks pull` reads the real `tools/list` from.
 * @param input.results - Answer per tool. The mock lists exactly the tools
 *   that have one, so a read-only connection's mock never lists the upstream's
 *   mutations. Every key must name a tool of the schema file; `check`
 *   enforces it. eve filters tools by the connection's allow-list anyway, so a
 *   tool without a result is one the model could not call.
 */
export function defineMcpMock({
  url,
  results,
}: {
  readonly url: string;
  readonly results: Readonly<Record<string, ToolResult>>;
}): Mock {
  let pulled: readonly Tool[] | undefined;

  /**
   * Every pulled tool.
   *
   * @throws MockError when the schema file was never pulled.
   */
  const loadTools = ({ name }: MockContext): readonly Tool[] => {
    if (pulled !== undefined) {
      return pulled;
    }

    const path = getSchemaPath({ name });

    if (!existsSync(path)) {
      throw createError({
        status: 404,
        message: `No schema for ${name} at ${path}`,
        why: `The mock lists the tools of ${url} from its pulled tools/list, and none has been pulled`,
        fix: `Run: eve-mocks pull ${name}`,
      });
    }

    pulled = (readJson({ path, fix: `Pull it again: eve-mocks pull ${name}` }) as { readonly tools: Tool[] }).tools;

    return pulled;
  };

  /** The tools a session sees: the ones with a result, and the ones its eval pinned with `mock(t, …)`. */
  const listServed = async (context: MockContext): Promise<readonly Tool[]> => {
    const pinnedNames = await listEvalOperations({ mock: context.name });

    return loadTools(context).filter((tool) => {
      return results[tool.name] !== undefined || pinnedNames.includes(tool.name);
    });
  };

  return {
    url,
    type: "mcp",
    handle: async (request, context) => {
      // Imported on the first call: the preload runs in every process the
      // agent spawns, and most of them never talk to this server.
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      const { WebStandardStreamableHTTPServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
      );
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
        "@modelcontextprotocol/sdk/types.js"
      );
      const server = new Server(
        { name: "eve-mocks", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: [...(await listServed(context))] };
      });

      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const args = params.arguments ?? {};

        // An eval's mock(t, …) first: it pins the answer for its own sessions only.
        const pinned = await askEvals({ mock: context.name, key: params.name, call: { kind: "tool", args } });

        if (pinned !== undefined) {
          return { content: [{ type: "text", text: JSON.stringify(await pinned.json(), null, 2) }] };
        }

        const result = results[params.name];

        if (!result) {
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool ${params.name}` }],
          };
        }

        // JSON text content: the shape MCP clients read from the hosted servers.
        const text = JSON.stringify(result(args), null, 2);

        return { content: [{ type: "text", text }] };
      });

      // No `sessionIdGenerator` means stateless.
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);

      return transport.handleRequest(request);
    },
    operations: (context) => {
      return loadTools(context).map(({ name }) => {
        return name;
      });
    },
    check: async (context) => {
      const all = loadTools(context).map(({ name }) => {
        return name;
      });

      for (const name of Object.keys(results)) {
        if (all.includes(name)) {
          continue;
        }

        const closest = getClosest({ value: name, candidates: all });

        throw createError({
          status: 500,
          message: `Result "${name}" names no tool of ${url}`,
          why: "The schema file lists no such tool, so the mock would never list it and this result can never be called",
          fix: `Did you mean ${closest}? Else refresh the schema file with eve-mocks pull ${context.name}`,
        });
      }
    },
    pull: async (context) => {
      const { name } = context;
      const merged = context.headers;
      const args = ["-y", INSPECTOR, "--cli", url, "--transport", "http", "--method", "tools/list"];

      for (const [key, value] of Object.entries(merged)) {
        args.push("--header", `${key}: ${value}`);
      }

      // stdin is inherited and stderr forwarded: the inspector's browser
      // sign-in needs a TTY on one of them, and prints its prompts on stderr.
      const child = spawn("npx", args, { stdio: ["inherit", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();

        stderr += text;

        // The lint summary is reported through `onLint`; its `--strict` hint names an inspector flag, not one of this CLI.
        const rest = text
          .split("\n")
          .filter((line) => {
            return !LINT_SUMMARY.test(line);
          })
          .join("\n");

        if (rest.trim() !== "") {
          process.stderr.write(rest);
        }
      });

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("close", resolve);
        child.on("error", (cause) => {
          reject(
            createError({
              status: 500,
              message: `tools/list failed for ${url}`,
              why: `npx, which runs the MCP inspector, could not start: ${cause.message}`,
              fix: "Install Node.js with npm, so that npx is on the PATH",
              cause,
            }),
          );
        });
      });

      if (code !== 0) {
        let fix = `Pass the server's auth header: eve-mocks pull ${name} --header "Authorization: Bearer <token>"`;

        // The inspector's own code for "needs a browser sign-in, has no terminal".
        if (stderr.includes("auth_required")) {
          fix = `The server uses OAuth. Run eve-mocks pull ${name} once in a terminal to sign in through the browser; the token is stored in ~/.mcp-inspector and later pulls, agent or CI, reuse it. For a static token instead: --header "Authorization: Bearer <token>"`;
        }

        throw createError({
          status: 502,
          message: `tools/list failed for ${url}`,
          why: `The MCP inspector exited with code ${code}; its output is above`,
          fix,
        });
      }

      const path = getSchemaPath({ name });
      let listed: { readonly tools: readonly Tool[] };

      try {
        listed = JSON.parse(stdout) as { readonly tools: readonly Tool[] };
      } catch (cause) {
        throw createError({
          status: 502,
          message: `tools/list failed for ${url}`,
          why: "The MCP inspector exited with 0 but printed something other than JSON; its output is above",
          fix: "Run the pull again; if it repeats, the inspector changed its output and eve-mocks needs an update",
          cause,
        });
      }

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ tools: listed.tools }, null, 2)}\n`);

      const lint = LINT_SUMMARY.exec(stderr);

      if (lint !== null) {
        context.onLint?.({ errors: Number(lint[1]), warnings: Number(lint[2]) });
      }

      return [path];
    },
  };
}

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createError } from "./errors.ts";
import { readJson } from "./read-json.ts";
import { getClosest } from "./get-closest.ts";
import { getSchemaPath } from "./get-schema-path.ts";
import type { Mock, MockContext, PullHeaders, ToolResult } from "./types.ts";

/**
 * The official MCP inspector, run through npx at pull time. It implements the
 * OAuth sign-in hosted MCP servers require (browser flow, token stored in
 * `~/.mcp-inspector`), which the SDK client leaves to its caller.
 * See https://github.com/modelcontextprotocol/inspector
 */
const INSPECTOR = "@modelcontextprotocol/inspector";

/** A tool as `tools/list` returns it. The model reads all three fields. */
type Tool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
};

/**
 * Mock a hosted MCP server from its pulled `tools/list` and a result per
 * tool. The schema file is `schemas/<mock>.tools.json`, which
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
 * @param input.headers - Static auth for `eve-mocks pull`, for a server that
 *   takes a bearer token. Sent by `pull` only. A server behind OAuth needs none: the pull signs in
 *   through the browser.
 */
export function defineMcpMock({
  url,
  results,
  headers,
}: {
  readonly url: string;
  readonly results: Readonly<Record<string, ToolResult>>;
  readonly headers?: PullHeaders;
}): Mock {
  let served: readonly Tool[] | undefined;

  /**
   * Pulled tools the mock serves: the ones with a result.
   *
   * @throws MockError when the schema file was never pulled.
   */
  const loadTools = ({ name }: MockContext): readonly Tool[] => {
    if (served !== undefined) {
      return served;
    }

    const path = getSchemaPath({ name, kind: "tools" });

    if (!existsSync(path)) {
      throw createError({
        status: 404,
        message: `No schema for ${name} at ${path}`,
        why: `The mock lists the tools of ${url} from its pulled tools/list, and none has been pulled`,
        fix: `Run: eve-mocks pull ${name}`,
      });
    }

    served = (readJson({ path, fix: `Pull it again: eve-mocks pull ${name}` }) as { readonly tools: Tool[] }).tools.filter(
      (tool) => {
        return results[tool.name] !== undefined;
      },
    );

    return served;
  };

  return {
    url,
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

      server.setRequestHandler(ListToolsRequestSchema, () => {
        return { tools: [...loadTools(context)] };
      });

      server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
        const result = results[params.name];

        if (!result) {
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool ${params.name}` }],
          };
        }

        // JSON text content: the shape MCP clients read from the hosted servers.
        const text = JSON.stringify(result(params.arguments ?? {}), null, 2);

        return { content: [{ type: "text", text }] };
      });

      // No `sessionIdGenerator` means stateless.
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);

      return transport.handleRequest(request);
    },
    check: async (context) => {
      const served = loadTools(context).map(({ name }) => {
        return name;
      });

      for (const name of Object.keys(results)) {
        if (served.includes(name)) {
          continue;
        }

        const path = getSchemaPath({ name: context.name, kind: "tools" });
        const all = (
          readJson({ path, fix: `Pull it again: eve-mocks pull ${context.name}` }) as { readonly tools: Tool[] }
        ).tools;
        const closest = getClosest({
          value: name,
          candidates: all.map((tool) => {
            return tool.name;
          }),
        });

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
      const merged = { ...(await headers?.()), ...context.headers };
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
        stderr += chunk.toString();
        process.stderr.write(chunk);
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
        let fix = `Pass the server's auth header: eve-mocks pull ${name} --header "Authorization: Bearer <token>", or set headers in the mock file`;

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

      const path = getSchemaPath({ name, kind: "tools" });
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

      return [path];
    },
  };
}

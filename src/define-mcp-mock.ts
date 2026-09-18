import { readFileSync, writeFileSync } from "node:fs";

import { createError } from "./errors.ts";
import { getClosest } from "./get-closest.ts";
import { resolvePath } from "./resolve-path.ts";
import type { Mock, PullOptions, ToolResult } from "./types.ts";

/** A tool as `tools/list` returns it. The model reads all three fields. */
type Tool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
};

/**
 * Mock a hosted MCP server from a snapshot of its `tools/list` and a result
 * per tool.
 *
 * The snapshot carries the real names, descriptions, and schemas, because the
 * model reads them: a paraphrased description makes an eval test a different
 * prompt than production.
 *
 * Stateless like the hosted servers: eve's MCP client calls tools without an
 * `mcp-session-id`, which a session-checking server rejects with HTTP 400.
 * Stateless mode needs a fresh server and transport per request.
 * See https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
 *
 * @param input.url - Production MCP endpoint to intercept, and what
 *   `eve-mocks pull` snapshots.
 * @param input.tools - Snapshot of `tools/list`: a file URL, or a path relative
 *   to the mocks directory.
 * @param input.results - Answer per tool. Every served tool needs one and
 *   every key must name a snapshot tool; `check` enforces both.
 * @param input.omit - Snapshot tools the mock does not list, such as the
 *   mutations a read-only connection never allows.
 * @param input.pull - How `eve-mocks pull` authenticates against `url`.
 */
export function defineMcpMock({
  url,
  tools,
  results,
  omit = [],
  pull,
}: {
  readonly url: string;
  readonly tools: string | URL;
  readonly results: Readonly<Record<string, ToolResult>>;
  readonly omit?: readonly string[];
  readonly pull?: PullOptions;
}): Mock {
  let snapshot: readonly Tool[] | undefined;

  /** Snapshot tools the mock serves: all but the omitted ones. */
  const loadTools = (): readonly Tool[] => {
    snapshot ??= (
      JSON.parse(readFileSync(resolvePath({ path: tools }), "utf8")) as { readonly tools: Tool[] }
    ).tools.filter(({ name }) => {
      return !omit.includes(name);
    });

    return snapshot;
  };

  return {
    url,
    handle: async (request) => {
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
        return { tools: [...loadTools()] };
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
    check: async () => {
      const names = loadTools().map(({ name }) => {
        return name;
      });

      for (const name of names) {
        if (results[name] === undefined) {
          throw createError({
            status: 500,
            message: `No result for tool "${name}" of ${url}`,
            why: "The snapshot lists it, so the model can call it, and the mock could not answer",
            fix: `Add results.${name}, or leave the tool out with omit: ["${name}"]`,
          });
        }
      }

      for (const name of Object.keys(results)) {
        if (!names.includes(name)) {
          throw createError({
            status: 500,
            message: `Result "${name}" names no tool of ${url}`,
            why: "The snapshot lists no such tool, or omit removes it, so this result can never be called",
            fix: `Did you mean ${getClosest({ value: name, candidates: names })}? Else refresh the snapshot with eve-mocks pull`,
          });
        }
      }
    },
    pull: async () => {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      const client = new Client({ name: "eve-mocks-pull", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: (await pull?.headers?.()) ?? {} },
      });

      try {
        // The SDK types `sessionId` as optional, which clashes with its own
        // `Transport` under `exactOptionalPropertyTypes`.
        await client.connect(transport as Parameters<typeof client.connect>[0]);
        const listed = await client.listTools();
        const path = resolvePath({ path: tools });
        writeFileSync(path, `${JSON.stringify({ tools: listed.tools }, null, 2)}\n`);

        return path;
      } catch (cause) {
        throw createError({
          status: 502,
          message: `tools/list failed for ${url}`,
          why: "The real MCP server refused the connection or the request",
          fix: "Check the credentials pull.headers reads; a server behind user OAuth needs a bearer token of a signed-in user",
          cause,
        });
      } finally {
        await client.close();
      }
    },
  };
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadMocks, type NamedMock } from "../load-mocks.ts";
import { mock } from "./mock.ts";
import { PORT_ENV } from "./protocol.ts";
import type { EvalContext, EvalSession } from "./scope.ts";

/** eve's context store, as the dev server's mocks read it. */
const STORAGE = Symbol.for("eve.context-storage");

let root: string;
let mocks: readonly NamedMock[];
let sessions = 0;

/** A free loopback port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();

    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();

      probe.close(() => {
        if (address === null || typeof address === "string") {
          throw new Error("No port");
        }

        resolve(address.port);
      });
    });
  });
}

/** An eval context the way eve shapes it: `session()` resolves with an id, `send()` runs a turn. */
function createContext(): EvalContext & { readonly sent: string[] } {
  const sent: string[] = [];
  const context: EvalContext & { readonly sent: string[] } = {
    sent,
    session: async () => {
      sessions += 1;

      const session: EvalSession = {
        sessionId: `session_${sessions}`,
        send: async (message) => {
          sent.push(String(message));

          return { sessionId: session.sessionId };
        },
      };

      return session;
    },
    send: async (message) => {
      sent.push(`direct ${String(message)}`);

      return {};
    },
  };

  return context;
}

/** Run `work` as eve runs a step of `sessionId`: with the id in the context store. */
async function inSession<T>({ sessionId, work }: { readonly sessionId: string | undefined; readonly work: () => Promise<T> }): Promise<T> {
  const store = sessionId === undefined ? undefined : { get: () => sessionId };

  (globalThis as Record<symbol, unknown>)[STORAGE] = { getStore: () => store };

  try {
    return await work();
  } finally {
    delete (globalThis as Record<symbol, unknown>)[STORAGE];
  }
}

function getMock({ name }: { readonly name: string }): NamedMock {
  const found = mocks.find((entry) => entry.name === name);

  if (found === undefined) {
    throw new Error(`No mock ${name}`);
  }

  return found;
}

/** A `tools/call` request as eve's MCP client sends it. */
function createToolCall({ name, args }: { readonly name: string; readonly args: Record<string, unknown> }): Request {
  return new Request("https://mcp.linear.app/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

/** A `tools/list` request. */
function createToolList(): Request {
  return new Request("https://mcp.linear.app/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

/** The tool result text of an MCP response. */
async function readToolText({ response }: { readonly response: Response }): Promise<unknown> {
  const { result } = (await response.json()) as { result: { content: { text: string }[] } };

  return JSON.parse(result.content[0]?.text ?? "null");
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "eve-mocks-evals-"));
  mkdirSync(join(root, "mocks/schemas"), { recursive: true });

  const index = JSON.stringify(join(import.meta.dir, "../index.ts"));

  writeFileSync(
    join(root, "mocks/linear.ts"),
    `import { defineMcpMock } from ${index};
     export default defineMcpMock({ url: "https://mcp.linear.app/mcp", results: { get_issue: (args) => ({ id: args.id, title: "from the mock file" }) } });`,
  );
  writeFileSync(
    join(root, "mocks/schemas/linear.json"),
    JSON.stringify({
      tools: [
        { name: "get_issue", inputSchema: { type: "object" } },
        { name: "create_issue", inputSchema: { type: "object" } },
        { name: "search", inputSchema: { type: "object" } },
      ],
    }),
  );
  writeFileSync(
    join(root, "mocks/notion.ts"),
    `import { defineHttpMock } from ${index};
     export default defineHttpMock({ url: "https://api.notion.com/", spec: "./notion.json", routes: { "/v1/pages/{page_id}": { GET: ({ params }) => ({ id: params.page_id, from: "the mock file" }) } } });`,
  );
  writeFileSync(
    join(root, "mocks/notion.json"),
    JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/v1/search": { post: { responses: { 200: { content: { "application/json": { example: { results: [] } } } } } } },
        "/v1/pages/{page_id}": { get: { responses: { 200: { content: { "application/json": { example: { id: "x" } } } } } } },
      },
    }),
  );
  writeFileSync(
    join(root, "mocks/schemas/notion.json"),
    JSON.stringify({ tools: [{ name: "search", inputSchema: { type: "object" } }] }),
  );
  writeFileSync(
    join(root, "mocks/notion-mcp.ts"),
    `import { defineMcpMock } from ${index};
     export default defineMcpMock({ url: "https://mcp.notion.com/mcp", results: {} });`,
  );
  writeFileSync(
    join(root, "mocks/schemas/notion-mcp.json"),
    JSON.stringify({ tools: [{ name: "search", inputSchema: { type: "object" } }] }),
  );

  process.env.EVE_MOCKS_DIR = join(root, "mocks");
  process.env[PORT_ENV] = String(await getFreePort());
  ({ mocks } = await loadMocks({ dir: join(root, "mocks") }));
});

afterAll(() => {
  rmSync(root, { recursive: true });
  delete process.env.EVE_MOCKS_DIR;
  delete process.env[PORT_ENV];
});

describe("mock(t, …) outside the wrapper", () => {
  test("names the missing port", async () => {
    const port = process.env[PORT_ENV];

    delete process.env[PORT_ENV];

    try {
      expect(() => mock(createContext(), "get_issue", {})).toThrow("mock() needs the eve-mocks wrapper");
    } finally {
      process.env[PORT_ENV] = port;
    }
  });
});

describe("mock(t, …)", () => {
  test("an MCP tool is answered for the eval's session, the mock file answers every other", async () => {
    const t = createContext();

    mock(t, "get_issue", (args) => ({ id: args.id, title: "pinned" }));

    const session = await t.session();
    const { mock: linear } = getMock({ name: "linear" });
    const call = () => linear.handle(createToolCall({ name: "get_issue", args: { id: "ENG-1" } }), { name: "linear" });

    expect(await readToolText({ response: await inSession({ sessionId: session.sessionId, work: call }) })).toEqual({
      id: "ENG-1",
      title: "pinned",
    });
    expect(await readToolText({ response: await inSession({ sessionId: "session_other", work: call }) })).toEqual({
      id: "ENG-1",
      title: "from the mock file",
    });
    expect(await readToolText({ response: await inSession({ sessionId: undefined, work: call }) })).toEqual({
      id: "ENG-1",
      title: "from the mock file",
    });
  });

  test("a fixed value answers, and a tool without a result in the mock file is listed to the eval's session", async () => {
    const t = createContext();

    mock(t, "create_issue", { id: "ENG-2" });

    const session = await t.session();
    const { mock: linear } = getMock({ name: "linear" });
    const listed = await inSession({
      sessionId: session.sessionId,
      work: () => linear.handle(createToolList(), { name: "linear" }),
    });
    const { result } = (await listed.json()) as { result: { tools: { name: string }[] } };

    expect(result.tools.map(({ name }) => name).sort()).toEqual(["create_issue", "get_issue"]);

    const other = await inSession({ sessionId: "session_other", work: () => linear.handle(createToolList(), { name: "linear" }) });
    const { result: otherResult } = (await other.json()) as { result: { tools: { name: string }[] } };

    expect(otherResult.tools.map(({ name }) => name)).toEqual(["get_issue"]);

    const created = await inSession({
      sessionId: session.sessionId,
      work: () => linear.handle(createToolCall({ name: "create_issue", args: {} }), { name: "linear" }),
    });

    expect(await readToolText({ response: created })).toEqual({ id: "ENG-2" });
  });

  test("undefined passes to the mock file, and a later mock() wins over an earlier one", async () => {
    const t = createContext();

    mock(t, "get_issue", () => ({ title: "first" }));
    mock(t, "get_issue", (args) => (args.id === "ENG-9" ? { title: "second" } : undefined));

    const session = await t.session();
    const { mock: linear } = getMock({ name: "linear" });
    const call = (id: string) => linear.handle(createToolCall({ name: "get_issue", args: { id } }), { name: "linear" });

    expect(await readToolText({ response: await inSession({ sessionId: session.sessionId, work: () => call("ENG-9") }) })).toEqual({ title: "second" });
    expect(await readToolText({ response: await inSession({ sessionId: session.sessionId, work: () => call("ENG-1") }) })).toEqual({ title: "first" });
  });

  test("an HTTP operation gets the request and its params, and may answer with a Response", async () => {
    const t = createContext();

    mock(t, "POST /v1/search", async ({ request }) => {
      const { query } = (await request.json()) as { query: string };

      return { results: [{ title: query }] };
    });
    mock(t, "GET /v1/pages/{page_id}", ({ params }) => new Response(null, { status: 403, headers: { "x-page": params.page_id ?? "" } }));

    const session = await t.session();
    const { mock: notion } = getMock({ name: "notion" });
    const search = await inSession({
      sessionId: session.sessionId,
      work: () => notion.handle(new Request("https://api.notion.com/v1/search", { method: "POST", body: JSON.stringify({ query: "Grid" }) }), { name: "notion" }),
    });

    expect(await search.json()).toEqual({ results: [{ title: "Grid" }] });

    const page = await inSession({
      sessionId: session.sessionId,
      work: () => notion.handle(new Request("https://api.notion.com/v1/pages/p1"), { name: "notion" }),
    });

    expect(page.status).toBe(403);
    expect(page.headers.get("x-page")).toBe("p1");

    const other = await inSession({
      sessionId: "session_other",
      work: () => notion.handle(new Request("https://api.notion.com/v1/pages/p1"), { name: "notion" }),
    });

    expect(await other.json()).toEqual({ id: "p1", from: "the mock file" });
  });

  test("t.send creates the session through t.session, so its id is known before the turn", async () => {
    const t = createContext();

    mock(t, "get_issue", { title: "sent" });

    const turn = (await t.send("hello")) as { sessionId: string };

    expect(t.sent).toEqual(["hello"]);

    const { mock: linear } = getMock({ name: "linear" });
    const answered = await inSession({
      sessionId: turn.sessionId,
      work: () => linear.handle(createToolCall({ name: "get_issue", args: {} }), { name: "linear" }),
    });

    expect(await readToolText({ response: answered })).toEqual({ title: "sent" });
  });

  test("a handler that throws fails the call and names the eval file", async () => {
    const t = createContext();

    mock(t, "get_issue", () => {
      throw new Error("boom");
    });

    const session = await t.session();
    const { mock: linear } = getMock({ name: "linear" });
    const response = await inSession({
      sessionId: session.sessionId,
      work: () => linear.handle(createToolCall({ name: "get_issue", args: {} }), { name: "linear" }),
    });
    const body = (await response.json()) as { error?: { message: string } };

    expect(body.error?.message).toContain("boom");
    expect(body.error?.message).toContain("mock.test.ts");
  });

  test("an operation that two mocks declare needs the mock's name", async () => {
    const ambiguous = createContext();

    mock(ambiguous, "search", {});
    await expect(ambiguous.session()).rejects.toThrow('mock(t, "linear:search" or "notion-mcp:search"');

    const named = createContext();

    mock(named, "linear:search", { hits: 1 });
    mock(named, "notion-mcp:search", { hits: 2 });
    await expect(named.session()).resolves.toBeDefined();
  });

  test("an unknown operation or mock fails the next t.send; a lower-case method is fine", async () => {
    const typo = createContext();

    mock(typo, "get_isue", {});
    await expect(typo.send("hi")).rejects.toThrow("Did you mean get_issue?");
    expect(typo.sent).toEqual([]);

    const unknown = createContext();

    mock(unknown, "linea:get_issue", {});
    await expect(unknown.session()).rejects.toThrow("No mock named linea");

    const lower = createContext();

    mock(lower, "post /v1/search", {});
    await expect(lower.session()).resolves.toBeDefined();
  });

  test("mock() without await is registered before the first t.send", async () => {
    const t = createContext();

    mock(t, "get_issue", { title: "not awaited" });

    const turn = (await t.send("hi")) as { sessionId: string };
    const { mock: linear } = getMock({ name: "linear" });
    const answered = await inSession({
      sessionId: turn.sessionId,
      work: () => linear.handle(createToolCall({ name: "get_issue", args: {} }), { name: "linear" }),
    });

    expect(await readToolText({ response: answered })).toEqual({ title: "not awaited" });
  });
});

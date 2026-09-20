/**
 * Answer the agent's upstream traffic from the mocks, inside the process.
 *
 * `eve-mocks --` loads this file into every process the wrapped command
 * spawns (`NODE_OPTIONS=--import`, `BUN_OPTIONS=--preload`), so connections
 * keep their production URLs and their real token code; only `fetch` changes.
 *
 * Deny by default: a request that is neither mocked nor allowed throws, so no
 * upstream is reached by accident. That covers eve's dynamic connections too,
 * whose URLs are unknown before a session starts.
 */

import { appendFileSync, readFileSync } from "node:fs";

import { createError } from "./errors.ts";
import { guardNodeHttp } from "./guard-node-http.ts";
import { loadMocks, type LoadedMocks } from "./load-mocks.ts";
import { getSignIn, SIGN_IN, SIGN_IN_ENV } from "./sign-in.ts";
import type { CallRecord } from "./types.ts";

const { EVE_MOCKS_DIR, EVE_MOCKS_LOG } = process.env;

if (EVE_MOCKS_DIR === undefined) {
  throw createError({
    status: 500,
    message: "EVE_MOCKS_DIR is not set",
    why: "The eve-mocks preload was loaded without the eve-mocks wrapper, which tells it where the mocks are",
    fix: "Start the command through: eve-mocks -- <command>",
  });
}

/** Filled once the mocks are loaded; the guard below is installed before that. */
let mocks: LoadedMocks["mocks"] = [];
let allowed: LoadedMocks["allowed"] = [];

/**
 * Hosts that always pass: eve's processes talk to each other over loopback,
 * and that traffic never leaves the machine.
 */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Append one call to the log `eve-mocks --` summarises at exit. */
function logCall(record: CallRecord): void {
  if (EVE_MOCKS_LOG !== undefined) {
    // One short line per call: appends from parallel processes do not interleave.
    appendFileSync(EVE_MOCKS_LOG, `${JSON.stringify(record)}\n`);
  }
}

// First, before a mock file can import a library: under Bun the guard only
// reaches modules that were not imported yet. Until the mocks are loaded
// nothing is allowed, which is the safe side.
guardNodeHttp({
  guard: ({ url, method, module }) => {
    const { protocol, hostname, host } = new URL(url);

    if (LOOPBACK_HOSTS.includes(hostname)) {
      return;
    }

    const pass = allowed.find(({ entry }) => {
      return url.startsWith(entry.url);
    });

    if (pass) {
      logCall({ outcome: "allow", target: pass.name, method, url });
      return;
    }

    logCall({ outcome: "block", target: host, method, url });

    const match = mocks.find(({ mock }) => {
      return url.startsWith(mock.url);
    });
    let fix = `Call it with fetch and mock it: eve-mocks add <connection>, or write mocks/<name>.ts\n       Or allow it in mocks/<name>.ts: export default allow({ url: "${protocol}//${host}/" })`;

    if (match) {
      fix = `The mock "${match.name}" covers this URL but answers fetch only: call it with fetch\n       Or allow it in mocks/<name>.ts: export default allow({ url: "${protocol}//${host}/" })`;
    }

    throw createError({
      status: 403,
      message: `eve-mocks block ${method} ${url}`,
      why: `Under --mocks a request must be mocked or allowed, and ${host} is neither. It went through ${module}, which eve-mocks blocks but cannot answer`,
      fix,
    });
  },
});

({ mocks, allowed } = await loadMocks({ dir: EVE_MOCKS_DIR }));

for (const { mock } of mocks) {
  for (const [key, value] of Object.entries(mock.env ?? {})) {
    process.env[key] ??= value;
  }
}

// After the mocks, so a mock's own value wins; a real value always does.
for (const [key, value] of Object.entries(SIGN_IN_ENV)) {
  process.env[key] ??= value;
}

/**
 * Tool name of an MCP `tools/call`, so the report says which tools an eval
 * used; every MCP call is a POST to one URL. Undefined for any other request.
 * See https://modelcontextprotocol.io/specification/2025-06-18/server/tools#calling-tools
 */
async function readTool({ request }: { readonly request: Request }): Promise<string | undefined> {
  if (request.method !== "POST" || !request.headers.get("content-type")?.includes("json")) {
    return undefined;
  }

  try {
    // A clone: the mock still reads the body.
    const body: unknown = await request.clone().json();

    if (
      typeof body === "object" &&
      body !== null &&
      "method" in body &&
      body.method === "tools/call" &&
      "params" in body &&
      typeof body.params === "object" &&
      body.params !== null &&
      "name" in body.params &&
      typeof body.params.name === "string"
    ) {
      return body.params.name;
    }
  } catch {
    // Not JSON after all: not an MCP call.
  }

  return undefined;
}

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = input.toString();
  let method = init?.method ?? "GET";

  if (input instanceof Request) {
    url = input.url;
    method = init?.method ?? input.method;
  }

  const match = mocks.find(({ mock }) => {
    return url.startsWith(mock.url);
  });

  if (match) {
    const request = new Request(input, init);
    const tool = await readTool({ request });

    logCall({ outcome: "mock", target: match.name, method, url, ...(tool !== undefined && { tool }) });
    return match.mock.handle(request, { name: match.name });
  }

  const { protocol, hostname, host } = new URL(url);

  // `data:`, `blob:`, and `file:` never reach a network.
  if ((protocol !== "http:" && protocol !== "https:") || LOOPBACK_HOSTS.includes(hostname)) {
    return realFetch(input, init);
  }

  const pass = allowed.find(({ entry }) => {
    return url.startsWith(entry.url);
  });

  if (pass) {
    logCall({ outcome: "allow", target: pass.name, method, url });
    return realFetch(input, init);
  }

  // A mock's own spec, which an eve connection downloads at run time.
  for (const { name, mock } of mocks) {
    const document = mock.documents?.({ name }).find((entry) => {
      return entry.url === url;
    });

    if (document) {
      logCall({ outcome: "mock", target: name, method, url });
      return new Response(readFileSync(document.path), { headers: { "content-type": "application/json" } });
    }
  }

  // Last, so it only ever replaces a blocked call: a mock or an allow entry
  // for the token endpoint has already won above.
  const request = new Request(input, init);
  const signIn = await getSignIn({ request });

  if (signIn) {
    logCall({ outcome: "mock", target: SIGN_IN, method, url });
    return signIn.handle(request, { name: SIGN_IN });
  }

  logCall({ outcome: "block", target: host, method, url });

  throw createError({
    status: 403,
    message: `eve-mocks block ${method} ${url}`,
    why: `Under --mocks a request must be mocked or allowed, and ${host} is neither`,
    fix: `Mock it: eve-mocks add <connection>, or write mocks/<name>.ts\n       Or allow it in mocks/<name>.ts: export default allow({ url: "${protocol}//${host}/" })`,
  });

}) as typeof fetch;

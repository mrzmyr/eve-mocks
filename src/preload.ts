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

import { appendFileSync } from "node:fs";

import { createError } from "./errors.ts";
import { loadMocks } from "./load-mocks.ts";
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

const { mocks, allowed } = await loadMocks({ dir: EVE_MOCKS_DIR });

for (const { mock } of mocks) {
  for (const [key, value] of Object.entries(mock.env ?? {})) {
    process.env[key] ??= value;
  }
}

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
    logCall({ outcome: "mocked", target: match.name, method, url });
    return match.mock.handle(new Request(input, init), { name: match.name });
  }

  const { protocol, hostname, host } = new URL(url);

  // `data:`, `blob:`, and `file:` never reach a network.
  if ((protocol !== "http:" && protocol !== "https:") || LOOPBACK_HOSTS.includes(hostname)) {
    return realFetch(input, init);
  }

  const isAllowed = allowed.some((entry) => {
    return url.startsWith(entry.url);
  });

  if (isAllowed) {
    logCall({ outcome: "allowed", target: host, method, url });
    return realFetch(input, init);
  }

  logCall({ outcome: "blocked", target: host, method, url });

  throw createError({
    status: 403,
    message: `${host} is neither mocked nor allowed`,
    why: `The agent called ${url} under --mocks, and eve-mocks lets no unmocked request out unless it is allowed`,
    fix: `Add a mock for it, or allow({ url: "${protocol}//${host}/" }) in the mocks directory`,
  });
}) as typeof fetch;

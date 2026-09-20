/**
 * Calls production URLs. Passes only under `eve-mocks -- … --mocks`, in a child process
 * too, which is how eve runs connections.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = await fetch("https://api.vercel.com/v1/connect/token/abc", { method: "POST" });
assert.equal(((await token.json()) as { token: string }).token, "mock-token");

const search = await fetch("https://api.notion.com/v1/search", { method: "POST", body: "{}" });
assert.equal(search.status, 200);
assert.ok(Array.isArray(((await search.json()) as { results: unknown[] }).results));

const me = await fetch("https://api.notion.com/v1/users/me");
assert.equal(((await me.json()) as { id: string }).id, "me");

const missing = await fetch("https://api.notion.com/v1/nope");
assert.equal(missing.status, 404);

const client = new Client({ name: "check", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.linear.app/mcp")) as never);
const { tools } = await client.listTools();
const call = (await client.callTool({ name: "get_issue", arguments: { id: "OPS-42" } })) as {
  content: ReadonlyArray<{ text: string }>;
};
await client.close();
assert.equal(tools.length, 1);
assert.equal((JSON.parse(call.content[0]?.text ?? "{}") as { identifier: string }).identifier, "OPS-42");

if (process.argv[2] !== "child") {
  const child = spawnSync(process.execPath, [import.meta.filename, "child"], { stdio: "inherit" });
  assert.equal(child.status, 0, "child process is mocked too");
}

console.log(`check ok (${process.argv[2] ?? "parent"}, ${process.versions.bun ? "bun" : "node"})`);

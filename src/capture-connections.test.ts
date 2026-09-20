import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createError } from "./errors.ts";

/**
 * `captureConnections` needs `module.registerHooks`, which Bun lacks, so each
 * case runs it in a Node child against an app with a stand-in `eve` package.
 */
let root: string;

/** Run `captureConnections` on one fixture module under Node. */
function capture({ file }: { readonly file: string }): unknown {
  const script = `
    import { captureConnections } from ${JSON.stringify(join(import.meta.dir, "capture-connections.ts"))};
    console.log(JSON.stringify(await captureConnections({ path: ${JSON.stringify(join(root, file))} })));
  `;
  const { stdout, stderr, status } = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });

  if (status !== 0) {
    throw createError({
      status: 500,
      message: `Capturing ${file} failed`,
      why: stderr,
      fix: "Read the Node error above; the fixture or capture-connections.ts is broken",
    });
  }

  return JSON.parse(stdout);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "eve-mocks-capture-"));
  mkdirSync(join(root, "node_modules/eve"), { recursive: true });
  mkdirSync(join(root, "lib"));

  writeFileSync(
    join(root, "node_modules/eve/package.json"),
    JSON.stringify({ name: "eve", type: "module", exports: { "./connections": "./connections.js" } }),
  );
  writeFileSync(
    join(root, "node_modules/eve/connections.js"),
    `export const defineMcpClientConnection = (input) => input;
     export const defineOpenAPIConnection = (input) => input;
     export const defineDynamic = (input) => input;`,
  );
  writeFileSync(join(root, "lib/gate.ts"), `export const isOpen = (): boolean => false;`);

  // The handler refuses every session: the URL must be read without running it.
  writeFileSync(
    join(root, "gated.ts"),
    `import { defineDynamic, defineMcpClientConnection } from "eve/connections";
     import { isOpen } from "./lib/gate.js";
     const connection = defineMcpClientConnection({ url: "https://mcp.example.com/mcp" });
     export default defineDynamic({ events: { "session.started": () => (isOpen() ? connection : null) } });`,
  );
  writeFileSync(
    join(root, "openapi.ts"),
    `import { defineDynamic, defineOpenAPIConnection } from "eve/connections";
     import { isOpen } from "./lib/gate";
     const connection = defineOpenAPIConnection({ url: "https://api.example.com" });
     export default defineDynamic({ events: { "session.started": () => (isOpen() ? connection : null) } });`,
  );
  writeFileSync(
    join(root, "per-session.ts"),
    `import { defineDynamic, defineMcpClientConnection } from "eve/connections";
     export default defineDynamic({
       events: { "session.started": (_event, ctx) => defineMcpClientConnection({ url: ctx.url }) },
     });`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("captureConnections", () => {
  test("reads the URL of a gated MCP connection without running its handler", () => {
    expect(capture({ file: "gated.ts" })).toEqual([{ url: "https://mcp.example.com/mcp", protocol: "mcp" }]);
  });

  test("names the protocol by constructor and resolves an extensionless import", () => {
    expect(capture({ file: "openapi.ts" })).toEqual([{ url: "https://api.example.com", protocol: "openapi" }]);
  });

  test("captures nothing when the connection is built inside the handler", () => {
    expect(capture({ file: "per-session.ts" })).toEqual([]);
  });
});

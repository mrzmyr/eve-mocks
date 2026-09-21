import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An empty app root: no mocks directory, no eve manifest. */
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "eve-mocks-cli-"));

/** An app root with one HTTP mock and a script that makes one mocked and one blocked call. */
const APP_ROOT = mkdtempSync(join(tmpdir(), "eve-mocks-cli-app-"));

mkdirSync(join(APP_ROOT, "mocks"));
writeFileSync(
  join(APP_ROOT, "mocks/shop.ts"),
  `import { defineHttpMock } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
   export default defineHttpMock({ url: "https://shop.example.com/", routes: { "/mcp": { POST: () => ({ ok: true }) } } });`,
);
writeFileSync(
  join(APP_ROOT, "agent.mjs"),
  `await fetch("https://shop.example.com/mcp", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_order" } }),
   });
   // Like a model that recovers from a failed tool call.
   if (process.argv.includes("--stray")) { await fetch("https://stray.example.com/").catch(() => {}); }`,
);

writeFileSync(
  join(APP_ROOT, "mocks/model-gateway.ts"),
  `import { allow } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
   export default allow({ url: "https://ai-gateway.vercel.sh/" });`,
);
writeFileSync(
  join(APP_ROOT, "mocks/allowed.ts"),
  `import { allow } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
   export default [allow({ url: "https://a.example.com/" }), allow({ url: "https://b.example.com/" })];`,
);

// One line per Node HTTP module: BLOCKED when the guard threw, else REACHED.
writeFileSync(
  join(APP_ROOT, "legacy.mjs"),
  `import http from "node:http";
   import { get } from "node:https";
   import { connect } from "node:http2";
   const attempt = (label, call) => {
     try { call(); console.log(label, "REACHED"); } catch (error) { console.log(label, "BLOCKED", error.message.split("\\n")[0]); }
   };
   attempt("https-named-import", () => get("https://stray.example.com/x").on("error", () => {}).destroy());
   attempt("http-options", () => http.request({ hostname: "stray.example.com", path: "/y", method: "post" }).on("error", () => {}).destroy());
   attempt("http2", () => connect("https://stray.example.com").on("error", () => {}).destroy());
   attempt("mocked-host", () => get("https://shop.example.com/mcp").on("error", () => {}).destroy());
   attempt("loopback", () => http.get("http://127.0.0.1:9/").on("error", () => {}).destroy());`,
);

// A mock whose spec is a URL, with the copy `pull` would have saved.
mkdirSync(join(APP_ROOT, "mocks/schemas"));
writeFileSync(
  join(APP_ROOT, "mocks/billing.ts"),
  `import { defineHttpMock } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
   export default defineHttpMock({ url: "https://billing.example.com/", spec: "https://specs.example.com/billing.json" });`,
);
writeFileSync(
  join(APP_ROOT, "mocks/schemas/billing.json"),
  JSON.stringify({ openapi: "3.1.0", info: { title: "Billing", version: "1" }, paths: {} }),
);
writeFileSync(
  join(APP_ROOT, "spec.mjs"),
  `const spec = await fetch("https://specs.example.com/billing.json");
   console.log((await spec.json()).info.title);`,
);

// A connection's sign-in: an OAuth token request, then Vercel Connect, then a plain POST.
writeFileSync(
  join(APP_ROOT, "sign-in.mjs"),
  `const oauth = await fetch("https://login.example.com/oauth/token", {
     method: "POST",
     headers: { "content-type": "application/x-www-form-urlencoded" },
     body: new URLSearchParams({ grant_type: "client_credentials", client_id: "x" }),
   });
   const connect = await fetch("https://api.vercel.com/v1/connect/token/linear", { method: "POST" });
   console.log((await oauth.json()).access_token, (await connect.json()).token);
   await fetch("https://login.example.com/users", { method: "POST", body: "{}" }).catch(() => console.log("plain POST blocked"));`,
);

/** Run the CLI on Node, as its shebang does; in an empty app root unless `cwd` names another. */
function run({ args, cwd = EMPTY_ROOT }: { readonly args: readonly string[]; readonly cwd?: string }) {
  return spawnSync("node", [join(import.meta.dir, "cli.ts"), ...args], { cwd, encoding: "utf8" });
}

describe("cli", () => {
  test("prints the overview without arguments and for --help", () => {
    const bare = run({ args: [] });

    expect(bare.status).toBe(0);
    expect(bare.stdout).toContain("Exit codes");
    expect(run({ args: ["-h"] }).stdout).toBe(bare.stdout);
  });

  test("prints the help of one command for <command> -h and help <command>", () => {
    const flag = run({ args: ["pull", "-h"] });

    expect(flag.stdout).toStartWith("eve-mocks pull");
    expect(run({ args: ["help", "pull"] }).stdout).toBe(flag.stdout);
  });

  test("prints the version", () => {
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
      version: string;
    };

    expect(run({ args: ["--version"] }).stdout.trim()).toBe(version);
  });

  test("exits 2 for an unknown command and hints at the nearest one", () => {
    const { status, stderr, stdout } = run({ args: ["lst"] });

    expect(status).toBe(2);
    expect(stderr).toContain('Did you mean "list"?');
    expect(stdout).toBe("");
  });

  test("exits 2 for an unknown option, as JSON on stderr under --json", () => {
    const { status, stderr, stdout } = run({ args: ["list", "--nope", "--json"] });

    expect(status).toBe(2);
    expect(JSON.parse(stderr).error.status).toBe(400);
    expect(stdout).toBe("");
  });

  test("info exits 0 on a broken setup and names each problem", () => {
    const { status, stdout } = run({ args: ["info", "--json"] });
    const { problems, counts } = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(problems).toHaveLength(2);
    expect(counts).toEqual({ mock: 0, allow: 0, block: 0 });
  });

  test("leaves the flags after -- to the wrapped command and passes its exit code on", () => {
    const { status, stdout } = run({
      args: ["--", "node", "-p", "process.exit(7)", "--", "-h", "--json"],
    });

    expect(status).toBe(7);
    expect(stdout).toBe("");
  });

  test("fails a run whose command succeeded but made a block", () => {
    const { status, stderr } = run({ args: ["--", "node", "agent.mjs", "--stray", "--mocks"], cwd: APP_ROOT });

    expect(status).toBe(1);
    expect(stderr).toContain("1 block failed the run");
    expect(stderr).toContain('allow({ url: "https://stray.example.com/" })');
  });

  test("lets that run pass with --no-fail-on-block, in the command or before --", () => {
    const inCommand = ["--", "node", "agent.mjs", "--stray", "--mocks", "--no-fail-on-block"];
    const before = ["--no-fail-on-block", "--", "node", "agent.mjs", "--stray", "--mocks"];

    expect(run({ args: inCommand, cwd: APP_ROOT }).status).toBe(0);
    expect(run({ args: before, cwd: APP_ROOT }).status).toBe(0);
  });

  test("writes the latest run to .eve-mocks/report.json, with MCP tool names, and ignores the folder in git", () => {
    expect(run({ args: ["--", "node", "agent.mjs", "--mocks"], cwd: APP_ROOT }).status).toBe(0);

    const report = JSON.parse(readFileSync(join(APP_ROOT, ".eve-mocks/report.json"), "utf8"));

    expect(report.counts).toEqual({ mock: 1, allow: 0, block: 0 });
    expect(report.targets).toEqual([
      { outcome: "mock", target: "shop", calls: 1, url: "https://shop.example.com/mcp", tools: { get_order: 1 } },
    ]);
    expect(readFileSync(join(APP_ROOT, ".eve-mocks/.gitignore"), "utf8")).toBe("*\n");
  });

  test("prints the run as a tree of outcome, upstream, and MCP tool", () => {
    const { stderr } = run({ args: ["--", "node", "agent.mjs", "--mocks"], cwd: APP_ROOT });

    expect(stderr).toContain(["  ✓ mock              1", "  └─ shop             1", "     └─ get_order     1"].join("\n"));
  });

  test("keeps a timestamped report per run next to its log", () => {
    expect(run({ args: ["--", "node", "agent.mjs", "--mocks"], cwd: APP_ROOT }).status).toBe(0);

    const latest = readFileSync(join(APP_ROOT, ".eve-mocks/report.json"), "utf8");
    const { log } = JSON.parse(latest);

    expect(readFileSync(log.replace(/l$/, ""), "utf8")).toBe(latest);
  });

  test("exits 127 with a fix when the wrapped command is not installed", () => {
    const { status, stderr } = run({ args: ["--", "no-such-command-eve-mocks"] });

    expect(status).toBe(127);
    expect(stderr).toContain("  fix  ");
  });

  test("refuses pull --header without a mock name, so a token goes to one upstream only", () => {
    const { status, stderr } = run({ args: ["pull", "--header", "Authorization: Bearer x"], cwd: APP_ROOT });

    expect(status).toBe(2);
    expect(stderr).toContain("pull --header needs a mock name");
  });

  for (const runtime of ["node", "bun"]) {
    test(`blocks node:http, node:https, and node:http2 under ${runtime}, and counts them as block`, () => {
      const { status, stdout } = run({ args: ["--", runtime, "legacy.mjs", "--mocks"], cwd: APP_ROOT });
      const lines = stdout.trim().split("\n");

      expect(lines).toEqual([
        "https-named-import BLOCKED eve-mocks block GET https://stray.example.com/x",
        "http-options BLOCKED eve-mocks block POST http://stray.example.com/y",
        "http2 BLOCKED eve-mocks block CONNECT https://stray.example.com/",
        "mocked-host BLOCKED eve-mocks block GET https://shop.example.com/mcp",
        "loopback REACHED",
      ]);
      expect(status).toBe(1);

      const report = JSON.parse(readFileSync(join(APP_ROOT, ".eve-mocks/report.json"), "utf8"));

      expect(report.counts.block).toBe(4);
    });
  }

  test("names an allow entry by its file, and entries that share a file by their host", () => {
    const { stdout } = run({ args: ["list", "--json"], cwd: APP_ROOT });
    const allowed = (JSON.parse(stdout) as { name: string; status: string }[])
      .filter(({ status }) => {
        return status === "allow";
      })
      .map(({ name }) => {
        return name;
      });

    expect(allowed).toEqual(["a.example.com", "b.example.com", "model-gateway"]);
  });

  test("answers a sign-in by default, and still blocks another POST to the same host", () => {
    const { stdout, stderr, status } = run({ args: ["--", "node", "sign-in.mjs", "--mocks"], cwd: APP_ROOT });

    expect(stdout.trim().split("\n")).toEqual(["mock-token mock-token", "plain POST blocked"]);
    expect(stderr).toContain("answered by default");
    expect(status).toBe(1);
  });

  test("answers a request for a mock's spec URL from the pulled copy", () => {
    const { stdout, status } = run({ args: ["--", "node", "spec.mjs", "--mocks"], cwd: APP_ROOT });

    expect(stdout.trim()).toBe("Billing");
    expect(status).toBe(0);
  });
});

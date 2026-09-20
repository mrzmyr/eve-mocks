#!/usr/bin/env node
/**
 * eve-mocks CLI.
 *
 *   eve-mocks [--dir mocks] -- <command>       run a command; upstreams mocked when
 *                                              the command carries --mocks
 *   eve-mocks list [--dir mocks]               every mock and the URL it claims
 *   eve-mocks pull [name] [--dir mocks]        refresh schemas from the real upstreams
 *   eve-mocks add <name> [--dir mocks]         scaffold a mock for an eve connection
 *   eve-mocks init [--dir mocks]               mocks folder + package.json scripts
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createError, MockError } from "./errors.ts";
import { getCoverage } from "./get-coverage.ts";
import { loadMocks } from "./load-mocks.ts";
import { readManifest } from "./read-manifest.ts";
import type { CallRecord } from "./types.ts";

/** The preload, as a file URL so a path with spaces survives `NODE_OPTIONS`. */
const PRELOAD = new URL("./preload.ts", import.meta.url);

/** Scripts `init` routes through `eve-mocks --` when the app defines them. */
const PROXIED_SCRIPTS = ["dev", "eval"];

/** Calls per target for one outcome, as `tracker 10, notion 6`. */
function formatCounts({
  records,
  outcome,
}: {
  readonly records: readonly CallRecord[];
  readonly outcome: CallRecord["outcome"];
}): string {
  const counts = new Map<string, number>();

  for (const record of records) {
    if (record.outcome === outcome) {
      counts.set(record.target, (counts.get(record.target) ?? 0) + 1);
    }
  }

  return [...counts]
    .map(([target, count]) => {
      return `${target} ${count}`;
    })
    .join(", ");
}

/** Print what was mocked, what went to a real upstream, and what was blocked. */
function reportCalls({ log }: { readonly log: string }): void {
  const records = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => {
      return line !== "";
    })
    .map((line) => {
      return JSON.parse(line) as CallRecord;
    });

  console.error("");

  for (const outcome of ["mocked", "allowed", "blocked"] as const) {
    const counts = formatCounts({ records, outcome });

    if (counts !== "") {
      console.error(`eve-mocks: ${outcome}: ${counts}`);
    }
  }

  if (records.length === 0) {
    console.error("eve-mocks: no upstream call was made");
  }

  console.error(`eve-mocks: call log: ${log}`);
}

/** Load the mocks and run each one's `check` against its schema file. */
async function checkMocks({ dir }: { readonly dir: string }): Promise<Awaited<ReturnType<typeof loadMocks>>> {
  const loaded = await loadMocks({ dir });

  for (const { name, mock } of loaded.mocks) {
    await mock.check?.({ name });
  }

  return loaded;
}

/** Flag that turns the mocks on. `run` removes it before the command sees it. */
const MOCKS_FLAG = "--mocks";

/**
 * Run `command`. With `--mocks` among its arguments, the preload is loaded
 * into it and every process it spawns; without, the command runs untouched.
 *
 * The flag sits in the command, not before `--`, because a package manager
 * appends script arguments at the end: `npm run eval -- --mocks` reaches this
 * CLI as `eve-mocks -- eve eval --mocks`.
 */
async function run({
  dir,
  command,
}: {
  readonly dir: string;
  readonly command: readonly string[];
}): Promise<void> {
  const [file, ...args] = command.filter((arg) => {
    return arg !== MOCKS_FLAG;
  });

  if (file === undefined) {
    throw createError({
      status: 400,
      message: "run needs a command",
      why: "eve-mocks was called without a command after --",
      fix: "Run: eve-mocks -- eve eval",
    });
  }

  if (!command.includes(MOCKS_FLAG)) {
    spawn(file, args, { stdio: "inherit" }).on("exit", (code) => {
      process.exit(code ?? 1);
    });
    return;
  }

  // Once, here: a typo in a route or a tool without a result stops the run
  // before the agent starts, instead of surfacing as an odd answer mid-eval.
  await checkMocks({ dir });

  const cache = mkdtempSync(join(tmpdir(), "eve-mocks-"));
  const log = join(cache, "calls.jsonl");
  writeFileSync(log, "");

  const child = spawn(file, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      EVE_MOCKS_DIR: dir,
      EVE_MOCKS_LOG: log,
      EVE_MOCKS_CACHE: cache,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${PRELOAD.href}`].filter(Boolean).join(" "),
      // Bun ignores NODE_OPTIONS. See https://bun.com/docs/runtime/bunfig#preload
      BUN_OPTIONS: [process.env.BUN_OPTIONS, `--preload=${fileURLToPath(PRELOAD)}`]
        .filter(Boolean)
        .join(" "),
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code) => {
    reportCalls({ log });
    process.exit(code ?? 1);
  });
}

/**
 * Print every connection and mock with its coverage status. Without a
 * compiled manifest the mocks are still listed, followed by how to get one.
 */
async function list({ dir }: { readonly dir: string }): Promise<void> {
  const { mocks } = await checkMocks({ dir });
  let connections: ReturnType<typeof readManifest> = [];
  let missing: MockError | undefined;

  try {
    connections = readManifest({ root: process.cwd() });
  } catch (error) {
    // Only a missing manifest is survivable; an unknown shape must surface.
    if (!(error instanceof MockError) || error.status !== 404) {
      throw error;
    }

    missing = error;
  }

  for (const { name, status, url, isConnection } of getCoverage({ connections, mocks })) {
    let note = url ?? "dynamic connection, URL unknown before a session starts";

    if (!isConnection) {
      note = `${note} (not an eve connection)`;
    }

    console.log(`${name.padEnd(24)}${status.padEnd(16)}${note}`);
  }

  if (missing) {
    console.error(`\neve-mocks: ${missing.message}`);
  }
}

/** Refresh the schema file of one mock, or of every mock that names a source. */
async function pull({ dir, name }: { readonly dir: string; readonly name: string | undefined }): Promise<void> {
  const { mocks } = await loadMocks({ dir });
  const selected = mocks.filter((entry) => {
    return name === undefined || entry.name === name;
  });

  if (selected.length === 0) {
    throw createError({
      status: 404,
      message: `No mock named "${name}"`,
      why: "A mock's name is its file name without the extension",
      fix: "Run eve-mocks list to see the names",
    });
  }

  let hasFailed = false;

  // One upstream being down or unauthenticated must not stop the others.
  for (const entry of selected) {
    try {
      const path = await entry.mock.pull?.({ name: entry.name });

      if (path === undefined) {
        console.log(`${entry.name.padEnd(24)}skipped: no schema source`);
      } else {
        console.log(`${entry.name.padEnd(24)}${path}`);
      }
    } catch (error) {
      if (!(error instanceof MockError)) {
        throw error;
      }

      hasFailed = true;
      console.error(`${entry.name.padEnd(24)}failed: ${error.message}`);
    }
  }

  if (hasFailed) {
    process.exit(1);
  }
}

/** Mock file for a connection, by protocol. The user fills in what the manifest does not know. */
function createScaffold({ name, url, protocol }: { readonly name: string; readonly url: string; readonly protocol: string }): string {
  if (protocol === "mcp") {
    return `import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "${url}",
  // Pull its tools/list with: eve-mocks pull ${name}
  pull: {
    headers: async () => {
      return { authorization: \`Bearer \${process.env.${name.toUpperCase().replaceAll("-", "_")}_TOKEN}\` };
    },
  },
  // One result per pulled tool; eve-mocks names the missing ones.
  results: {},
});
`;
  }

  return `import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "${url}",
  // Name the upstream's OpenAPI JSON, then run: eve-mocks pull ${name}
  // source: "https://…/openapi.json",
  // Pin what evals assert on: routes: { "/path/{id}": { GET: ({ params }) => ({}) } }
  routes: {},
});
`;
}

/** Write `mocks/<name>.ts` for an eve connection, from the manifest's protocol and URL. */
function add({ dir, name }: { readonly dir: string; readonly name: string | undefined }): void {
  const connections = readManifest({ root: process.cwd() });
  const connection = connections.find((entry) => {
    return entry.name === name && entry.url !== undefined;
  });

  if (name === undefined || !connection?.url || !connection.protocol) {
    const isDynamic = connections.some((entry) => {
      return entry.name === name;
    });
    let why = "eve's compiled manifest lists no connection of that name";

    if (isDynamic) {
      why = "It is a dynamic connection: eve resolves its URL and protocol when a session starts, so the manifest has neither";
    }

    throw createError({
      status: 404,
      message: `Cannot scaffold a mock for "${name}"`,
      why,
      fix: "Run eve-mocks list for the names, or write the mock by hand; for a dynamic connection the file name must equal the connection name",
    });
  }

  const path = join(dir, `${name}.ts`);

  if (existsSync(path)) {
    throw createError({
      status: 409,
      message: `${path} already exists`,
      why: "add never overwrites a mock",
      fix: "Edit the file, or delete it first",
    });
  }

  writeFileSync(path, createScaffold({ name, url: connection.url, protocol: connection.protocol }));
  console.log(`created ${path}`);
}

/** Create the mocks folder and route the app's eve scripts through `eve-mocks --`. */
function init({ dir }: { readonly dir: string }): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "vercel-connect.ts"),
      `import { vercelConnect } from "eve-mocks";\n\nexport default vercelConnect();\n`,
    );
    console.log(`created ${dir}`);
  }

  const manifestPath = resolve("package.json");

  if (!existsSync(manifestPath)) {
    throw createError({
      status: 404,
      message: "No package.json in this directory",
      why: "init routes the app's package.json scripts through eve-mocks --",
      fix: "Run eve-mocks init from the app root",
    });
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = manifest.scripts ?? {};

  for (const name of PROXIED_SCRIPTS) {
    const script = scripts[name];

    if (script === undefined || script.startsWith("eve-mocks ")) {
      continue;
    }

    // The shell splits a chained script before this CLI runs, so only its
    // first command would be wrapped.
    if (script.includes("&&") || script.includes(";") || script.includes("|")) {
      console.log(`skipped script ${name}: wrap the command that starts eve by hand`);
      continue;
    }

    scripts[name] = `eve-mocks -- ${script}`;
    console.log(`script ${name} now accepts ${MOCKS_FLAG}`);
  }

  manifest.scripts = scripts;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const { values, positionals, tokens } = parseArgs({
  allowPositionals: true,
  tokens: true,
  options: { dir: { type: "string", default: "mocks" } },
});
const dir = resolve(values.dir);

// Everything after `--` is the wrapped command; a word before it is a subcommand.
const terminator = tokens.find((token) => {
  return token.kind === "option-terminator";
});
const isWrapper = terminator !== undefined && positionals.length > 0;
const [name = "", target] = positionals;

// Schema files are located relative to the mocks directory.
process.env.EVE_MOCKS_DIR = dir;

try {
  if (isWrapper) {
    await run({ dir, command: positionals });
  } else if (name === "list") {
    await list({ dir });
  } else if (name === "pull") {
    await pull({ dir, name: target });
  } else if (name === "add") {
    add({ dir, name: target });
  } else if (name === "init") {
    init({ dir });
  } else {
    throw createError({
      status: 400,
      message: `Unknown command "${name}"`,
      why: "The first argument must name a command",
      fix: "Run eve-mocks -- <command>, or eve-mocks list, pull, add, or init",
    });
  }
} catch (error) {
  // Operator errors carry their own why and fix; a stack trace adds nothing.
  if (!(error instanceof MockError)) {
    throw error;
  }

  console.error(`eve-mocks: ${error.message}`);
  process.exit(1);
}

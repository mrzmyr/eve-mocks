#!/usr/bin/env node
/**
 * eve-mocks CLI.
 *
 * Commands, options, output, and exit codes are documented in `help.ts`, which
 * `eve-mocks --help` prints.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";

import { createError, MockError } from "./errors.ts";
import { readJson } from "./read-json.ts";
import { getClosest } from "./get-closest.ts";
import { getCoverage, type Coverage } from "./get-coverage.ts";
import { getInfo } from "./get-info.ts";
import { COMMAND_HELP, COMMANDS, isCommand, OVERVIEW } from "./help.ts";
import { loadMocks } from "./load-mocks.ts";
import { readManifest } from "./read-manifest.ts";
import { createLog, STATE_DIR, writeReport, type Report } from "./report.ts";
import { resolveConnections } from "./resolve-connections.ts";
import type { CallRecord } from "./types.ts";

/** The preload, as a file URL so a path with spaces survives `NODE_OPTIONS`. */
const PRELOAD = new URL("./preload.ts", import.meta.url);

/** Scripts `init` routes through `eve-mocks --` when the app defines them. */
const PROXIED_SCRIPTS = ["dev", "eval"];

/**
 * Colour of each outcome, in `list` and in the run summary. `allowed` warns:
 * it is the one outcome that reaches a real upstream.
 */
const OUTCOME_COLORS = { mocked: "green", allowed: "yellow", blocked: "red" } as const;

/** Icon of each outcome, so `list` still reads without colour. */
const OUTCOME_ICONS = { mocked: "✓", allowed: "→", blocked: "✗" } as const;

/** What each outcome means, for the legend below `list`. */
const OUTCOME_LEGEND = {
  mocked: "a mock answers",
  allowed: "reaches the real upstream",
  blocked: "the call throws",
} as const;

/**
 * An outcome with its icon, coloured. Padded first: escape codes would count
 * towards the width. `stream` is where it is printed, so the colour follows
 * that stream's terminal, not stdout's.
 */
function formatOutcome({
  outcome,
  width,
  stream = process.stdout,
}: {
  readonly outcome: CallRecord["outcome"];
  readonly width: number;
  readonly stream?: NodeJS.WriteStream;
}): string {
  // styleText drops the colour for NO_COLOR and for a stream that is not a TTY.
  // See https://nodejs.org/api/util.html#utilstyletextformat-text-options
  return styleText(OUTCOME_COLORS[outcome], `${OUTCOME_ICONS[outcome]} ${outcome}`.padEnd(width), { stream });
}

/** Label of each upstream type in `list`. */
const TYPE_LABELS = { mcp: "MCP", http: "HTTP" } as const;

/**
 * Print what was mocked, what went to a real upstream, and what was blocked.
 *
 * One titled block on stderr, in the icons and colours of `list`. The title
 * tells the block apart from the wrapped command's own output, so its rows
 * need no prefix.
 */
function printReport({ report }: { readonly report: Report }): void {
  const stream = process.stderr;

  console.error(`\n${styleText("bold", "eve-mocks", { stream })}`);

  for (const outcome of ["mocked", "allowed", "blocked"] as const) {
    const counts = report.targets
      .filter((entry) => {
        return entry.outcome === outcome;
      })
      .map(({ target, calls }) => {
        return `${target} ${calls}`;
      })
      .join(", ");

    if (counts !== "") {
      console.error(`  ${formatOutcome({ outcome, width: 12, stream })}${counts}`);
    }
  }

  if (report.targets.length === 0) {
    console.error("  no upstream call was made");
  }

  console.error(styleText("dim", `  ${"report".padEnd(12)}${join(STATE_DIR, "report.json")}`, { stream }));
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

/** Flag that lets a run with blocked calls succeed. `run` removes it before the command sees it. */
const ALLOW_BLOCKED_FLAG = "--no-fail-on-blocked";

/**
 * Start the wrapped command. A command that cannot start, such as one that is
 * not installed, ends the process with 127, the shell's code for it.
 */
function start({
  file,
  args,
  env,
}: {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): ReturnType<typeof spawn> {
  const child = spawn(file, args, { stdio: "inherit", env });

  child.on("error", (cause) => {
    const error = createError({
      status: 404,
      message: `Cannot start "${file}"`,
      why: cause.message,
      fix: `Install ${file}, or run it through the package manager: eve-mocks -- npx ${file}`,
      cause,
    });

    console.error(`eve-mocks: ${error.message}`);
    process.exit(127);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  return child;
}

/**
 * Run `command`. With `--mocks` among its arguments, the preload is loaded
 * into it and every process it spawns; without, the command runs untouched.
 *
 * Both flags sit in the command, not before `--`, because a package manager
 * appends script arguments at the end: `npm run eval -- --mocks` reaches this
 * CLI as `eve-mocks -- eve eval --mocks`.
 *
 * A run whose command succeeded still exits 1 when a call was blocked: the
 * agent reached for an upstream nobody decided on, and a model that recovers
 * from the thrown error would hide that behind a passing eval.
 */
async function run({
  dir,
  command,
  shouldFailOnBlocked,
}: {
  readonly dir: string;
  readonly command: readonly string[];
  readonly shouldFailOnBlocked: boolean;
}): Promise<void> {
  const [file, ...args] = command.filter((arg) => {
    return arg !== MOCKS_FLAG && arg !== ALLOW_BLOCKED_FLAG;
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
    start({ file, args, env: process.env }).on("exit", (code) => {
      process.exit(code ?? 1);
    });
    return;
  }

  // Once, here: a typo in a route or a tool without a result stops the run
  // before the agent starts, instead of surfacing as an odd answer mid-eval.
  await checkMocks({ dir });

  const root = process.cwd();
  const startedAt = new Date();
  const log = createLog({ root, startedAt });

  const child = start({
    file,
    args,
    env: {
      ...process.env,
      EVE_MOCKS_DIR: dir,
      EVE_MOCKS_LOG: log,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${PRELOAD.href}`].filter(Boolean).join(" "),
      // Bun ignores NODE_OPTIONS. See https://bun.com/docs/runtime/bunfig#preload
      BUN_OPTIONS: [process.env.BUN_OPTIONS, `--preload=${fileURLToPath(PRELOAD)}`]
        .filter(Boolean)
        .join(" "),
    },
  });

  child.on("exit", (code) => {
    const exitCode = code ?? 1;
    const report = writeReport({ root, log, command: [file, ...args], startedAt, exitCode });

    printReport({ report });

    if (exitCode === 0 && report.counts.blocked > 0 && shouldFailOnBlocked && !command.includes(ALLOW_BLOCKED_FLAG)) {
      const error = createError({
        status: 403,
        message: `The run made blocked calls: ${report.counts.blocked}`,
        why: "The command succeeded, but the agent called upstreams that are neither mocked nor allowed; see the blocked line above",
        fix: `Mock or allow() each blocked host. To let such a run pass, add ${ALLOW_BLOCKED_FLAG}`,
      });

      console.error(`eve-mocks: ${error.message}`);
      process.exit(1);
    }

    process.exit(exitCode);
  });
}

/** Print one titled section of `list`, a blank line below it; nothing for a section without rows. */
function printRows({ title, rows }: { readonly title: string; readonly rows: readonly Coverage[] }): void {
  if (rows.length === 0) {
    return;
  }

  console.log(styleText("bold", title));

  for (const { name, status, url, type, isDynamic } of rows) {
    let target = url ?? "dynamic connection, its module constructs no URL before a session starts";

    if (isDynamic && url !== undefined) {
      target = `${target}${styleText("dim", " (dynamic)")}`;
    }

    let label = "-";

    if (type !== undefined) {
      label = TYPE_LABELS[type];
    }

    console.log(`  ${name.padEnd(24)}${formatOutcome({ outcome: status, width: 12 })}${styleText("dim", label.padEnd(6))}${target}`);
  }

  console.log("");
}

/**
 * Print the app's eve connections, then the mocks and allow entries that match
 * none of them, such as a token endpoint, each with what a call does. Without a
 * compiled manifest the mocks are still listed, followed by how to get one.
 *
 * With `isJson`, stdout holds the {@link Coverage} rows as one JSON array and
 * nothing else, so it pipes into `jq`; the manifest hint still goes to stderr.
 */
async function list({ dir, isJson }: { readonly dir: string; readonly isJson: boolean }): Promise<void> {
  const { mocks, allowed } = await checkMocks({ dir });
  let connections: ReturnType<typeof readManifest> = [];
  let missing: MockError | undefined;

  try {
    connections = await resolveConnections({ connections: readManifest({ root: process.cwd() }) });
  } catch (error) {
    // Only a missing manifest is survivable; an unknown shape must surface.
    if (!(error instanceof MockError) || error.status !== 404) {
      throw error;
    }

    missing = error;
  }

  const rows = getCoverage({ connections, mocks, allowed });

  if (isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printSections({ rows });
  }

  if (missing) {
    console.error(`\neve-mocks: ${missing.message}`);
  }
}

/** Print `list` for a person: both sections, then the legend. */
function printSections({ rows }: { readonly rows: readonly Coverage[] }): void {
  printRows({
    title: "eve connections",
    rows: rows.filter(({ isConnection }) => {
      return isConnection;
    }),
  });
  printRows({
    title: "other upstreams",
    rows: rows.filter(({ isConnection }) => {
      return !isConnection;
    }),
  });

  const legend = (["mocked", "allowed", "blocked"] as const).map((outcome) => {
    return `${formatOutcome({ outcome, width: 0 })}: ${OUTCOME_LEGEND[outcome]}`;
  });

  console.log(styleText("dim", "under --mocks: ") + legend.join(styleText("dim", " · ")));
}

/** `--header "Name: value"` flags as a header record. */
function parseHeaders({ flags }: { readonly flags: readonly string[] }): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const flag of flags) {
    const separator = flag.indexOf(":");

    if (separator < 1) {
      throw createError({
        status: 400,
        message: `Cannot read --header "${flag}"`,
        why: "A header is a name and a value separated by a colon",
        fix: 'Pass it as --header "Authorization: Bearer <token>"',
      });
    }

    headers[flag.slice(0, separator).trim()] = flag.slice(separator + 1).trim();
  }

  return headers;
}

/** Refresh the schema files of one mock, or of every mock with something remote to pull. */
async function pull({
  dir,
  name,
  headers,
}: {
  readonly dir: string;
  readonly name: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
}): Promise<void> {
  // A header is a credential for one upstream; on a bare pull it would go to all of them.
  if (name === undefined && Object.keys(headers).length > 0) {
    throw createError({
      status: 400,
      message: "pull --header needs a mock name",
      why: "Without a name every mock is pulled, and the header, usually a token, would be sent to each upstream",
      fix: 'Name the mock the header is for: eve-mocks pull <name> --header "Name: value"',
    });
  }

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
      const paths = (await entry.mock.pull?.({ name: entry.name, headers })) ?? [];

      if (paths.length === 0) {
        console.log(`${entry.name.padEnd(24)}skipped: nothing remote to pull`);
      }

      for (const path of paths) {
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
  // The mock lists the tools that have a result here.
  results: {},
});
`;
  }

  return `import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "${url}",
  // Name the upstream's OpenAPI JSON. A URL is pulled with: eve-mocks pull ${name}
  // A local path, such as the file the connection imports, is read in place.
  // spec: "https://…/openapi.json",
  // Pin what evals assert on: routes: { "/path/{id}": { GET: ({ params }) => ({}) } }
  routes: {},
});
`;
}

/** Write `mocks/<name>.ts` for an eve connection, from its protocol and URL. */
async function add({ dir, name }: { readonly dir: string; readonly name: string | undefined }): Promise<void> {
  if (name === undefined) {
    throw createError({
      status: 400,
      message: "add needs a connection name",
      why: "The name picks the eve connection whose URL and protocol go into the mock",
      fix: "Run eve-mocks list for the names, then eve-mocks add <name>",
    });
  }

  const connections = await resolveConnections({ connections: readManifest({ root: process.cwd() }) });
  const connection = connections.find((entry) => {
    return entry.name === name && entry.url !== undefined;
  });

  if (!connection?.url || !connection.protocol) {
    const isDynamic = connections.some((entry) => {
      return entry.name === name;
    });
    let why = "eve's compiled manifest lists no connection of that name";

    if (isDynamic) {
      why = "It is a dynamic connection whose module constructs no URL while it loads, so neither URL nor protocol is known before a session starts";
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

  const manifest = readJson({ path: manifestPath, fix: "Fix the JSON syntax of package.json" }) as {
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

  // `bun run mocks list` reads better than `bunx eve-mocks list`, and pins the local version.
  if (scripts.mocks === undefined) {
    scripts.mocks = "eve-mocks";
    console.log("script mocks added: bun run mocks list");
  }

  manifest.scripts = scripts;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Print what `getInfo` found, for a person or as JSON. */
async function info({ dir, isJson }: { readonly dir: string; readonly isJson: boolean }): Promise<void> {
  const found = await getInfo({ root: process.cwd(), dir });

  if (isJson) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  const { version, runtime, mocksDir, manifest, eve, counts, problems } = found;
  const rows = [
    ["eve-mocks", version],
    ["runtime", runtime],
    ["eve", eve ?? "not installed"],
    ["mocks dir", `${mocksDir.path} (${mocksDir.mocks} mocks, ${mocksDir.allowed} allowed)`],
    ["manifest", `${manifest.path} (version ${manifest.version ?? "unknown"})`],
    [
      "connections",
      (["mocked", "allowed", "blocked"] as const)
        .map((outcome) => {
          return `${formatOutcome({ outcome, width: 0 })} ${counts[outcome]}`;
        })
        .join("  "),
    ],
  ];

  for (const [label = "", value = ""] of rows) {
    console.log(`${styleText("bold", label.padEnd(14))}${value}`);
  }

  for (const problem of problems) {
    console.log(`${styleText("red", "problem".padEnd(14))}${problem}`);
  }
}

/** Print the overview, or the help of `command`. */
function help({ command }: { readonly command: string | undefined }): void {
  if (command === undefined) {
    console.log(OVERVIEW);
    return;
  }

  if (!isCommand(command)) {
    throw createUnknownCommand({ name: command });
  }

  console.log(COMMAND_HELP[command]);
}

/** The usage error for a word that names no command, with the nearest one as a hint. */
function createUnknownCommand({ name }: { readonly name: string }): MockError {
  return createError({
    status: 400,
    message: `Unknown command "${name}"`,
    why: `The first argument must be one of: ${COMMANDS.join(", ")}`,
    fix: `Did you mean "${getClosest({ value: name, candidates: COMMANDS })}"? Run eve-mocks --help for every command`,
  });
}

/** Version of this package. */
function getVersion(): string {
  const { version } = readJson({
    path: fileURLToPath(new URL("../package.json", import.meta.url)),
    fix: "Reinstall eve-mocks",
  }) as {
    readonly version: string;
  };

  return version;
}

/**
 * Report an error and exit: 2 for wrong usage, else 1. With `--json` the error
 * is one JSON object on stderr, so stdout stays empty for a parser.
 *
 * Anything that is not a {@link MockError} is a defect. It is reported in the
 * same shape, so a caller never has to parse a second format, and its stack
 * follows for the bug report.
 */
function fail({ error: thrown, isJson }: { readonly error: unknown; readonly isJson: boolean }): never {
  let error = thrown;

  if (!(error instanceof MockError)) {
    let why = String(thrown);

    if (thrown instanceof Error) {
      why = thrown.stack ?? thrown.message;
    }

    error = createError({
      status: 500,
      message: "eve-mocks hit an unexpected error",
      why,
      fix: "This is a bug in eve-mocks, or an error thrown by a mock handler. Report it with the stack above: https://github.com/mrzmyr/eve-mocks/issues",
      cause: thrown,
    });
  }

  if (!(error instanceof MockError)) {
    throw error;
  }

  const { status, summary, why, fix, link } = error;

  if (isJson) {
    console.error(JSON.stringify({ error: { status, message: summary, why, fix, link } }));
  } else {
    console.error(`eve-mocks: ${error.message}`);
  }

  let code = 1;

  if (status === 400) {
    code = 2;
  }

  process.exit(code);
}

/**
 * `--json` as typed before `--`, read ahead of parsing so a parse error honours
 * it. A `--json` after `--` belongs to the wrapped command.
 */
const isJson = process.argv.slice(2, process.argv.indexOf("--") >>> 0).includes("--json");

/** Parse the command line; an unknown option becomes a usage error instead of a stack trace. */
function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      // For --no-fail-on-blocked. See https://nodejs.org/api/util.html#utilparseargsconfig
      allowNegative: true,
      tokens: true,
      options: {
        dir: { type: "string", default: "mocks" },
        header: { type: "string", multiple: true, default: [] },
        json: { type: "boolean", default: false },
        "fail-on-blocked": { type: "boolean", default: true },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    let why = String(error);

    if (error instanceof Error) {
      why = error.message;
    }

    return fail({
      error: createError({
        status: 400,
        message: "Cannot read the command line",
        why,
        fix: "Run eve-mocks --help for the options; put the wrapped command's own flags after --",
        cause: error,
      }),
      isJson,
    });
  }
}

const { values, positionals, tokens } = parse();
const dir = resolve(values.dir);

// Everything after `--` is the wrapped command; a word before it is a subcommand.
const terminator = tokens.find((token) => {
  return token.kind === "option-terminator";
});
const isWrapper = terminator !== undefined && positionals.length > 0;
const [name, target] = positionals;

// Schema files are located relative to the mocks directory.
process.env.EVE_MOCKS_DIR = dir;

try {
  if (values.version) {
    console.log(getVersion());
  } else if (values.help && !isWrapper) {
    help({ command: name });
  } else if (isWrapper) {
    await run({ dir, command: positionals, shouldFailOnBlocked: values["fail-on-blocked"] });
  } else if (name === undefined) {
    help({ command: undefined });
  } else if (name === "help") {
    help({ command: target });
  } else if (name === "list") {
    await list({ dir, isJson: values.json });
  } else if (name === "info") {
    await info({ dir, isJson: values.json });
  } else if (name === "pull") {
    await pull({ dir, name: target, headers: parseHeaders({ flags: values.header }) });
  } else if (name === "add") {
    await add({ dir, name: target });
  } else if (name === "init") {
    init({ dir });
  } else {
    throw createUnknownCommand({ name });
  }
} catch (error) {
  fail({ error, isJson });
}

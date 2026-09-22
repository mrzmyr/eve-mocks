#!/usr/bin/env node
/**
 * eve-mocks CLI.
 *
 * Commands, options, output, and exit codes are documented in `help.ts`, which
 * `eve-mocks --help` prints.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";

import { createError, MockError } from "./errors.ts";
import { EVE_DEV, isEveDevCommand } from "./eve-dev.ts";
import { PORT_ENV } from "./evals/protocol.ts";
import { readJson } from "./read-json.ts";
import { getClosest } from "./get-closest.ts";
import { getCoverage, type Coverage } from "./get-coverage.ts";
import { getInfo } from "./get-info.ts";
import { COMMAND_HELP, COMMANDS, isCommand, MARK, OVERVIEW } from "./help.ts";
import { loadMocks } from "./load-mocks.ts";
import { readManifest } from "./read-manifest.ts";
import { createLog, STATE_DIR, writeReport, type Report } from "./report.ts";
import { resolveConnections } from "./resolve-connections.ts";
import { SIGN_IN } from "./sign-in.ts";
import type { CallRecord, PullLint } from "./types.ts";

/**
 * The preload, as a file URL so a path with spaces survives `NODE_OPTIONS`.
 * It sits next to this file with the same extension: `.ts` in the source tree,
 * `.js` in the published build.
 */
const PRELOAD = new URL(import.meta.url.endsWith(".ts") ? "./preload.ts" : "./preload.js", import.meta.url);

/** Scripts `init` routes through `eve-mocks --` when the app defines them. */
const PROXIED_SCRIPTS = ["dev", "eval"];

/**
 * Colour of each outcome, in `list` and in the run summary. `allow` warns:
 * it is the one outcome that reaches a real upstream.
 */
const OUTCOME_COLORS = { mock: "green", allow: "yellow", block: "red" } as const;

/** Icon of each outcome, so `list` still reads without colour. */
const OUTCOME_ICONS = { mock: "✓", allow: "→", block: "✗" } as const;

/** Label of each outcome as printed: the verb, so it reads as what the call does. */
const OUTCOME_LABELS = { mock: "mock", allow: "allow", block: "block" } as const;

/** What each outcome means, for the legend below `list`. */
const OUTCOME_LEGEND = {
  mock: "a mock answers",
  allow: "reaches the real upstream",
  block: "the call throws",
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
  return styleText(OUTCOME_COLORS[outcome], `${OUTCOME_ICONS[outcome]} ${OUTCOME_LABELS[outcome]}`.padEnd(width), { stream });
}

/** Lines of the run summary's tree: a row, the last row of its parent, and the line that passes a row's children. */
const BRANCH = "├─ ";
const LAST_BRANCH = "└─ ";
const TRUNK = "│  ";

/** Row for the calls to an MCP upstream that named no tool, such as `initialize` and `tools/list`. */
const OTHER = "other";

/** Label of each upstream type in `list`. */
const TYPE_LABELS = { mcp: "MCP", http: "HTTP" } as const;

/** A count with its noun: `1 call`, `3 calls`. */
function formatCount({ count, noun }: { readonly count: number; readonly noun: string }): string {
  if (count === 1) {
    return `1 ${noun}`;
  }

  return `${count} ${noun}s`;
}

/** A path as typed from the working directory: shorter than the absolute one, and it pastes into a command. */
function formatPath({ path }: { readonly path: string }): string {
  return relative(process.cwd(), path) || ".";
}

/** Lines of a diff, in the colours of `git diff`: `+` for what a command wrote, `-` for what it replaced. */
function formatDiff({ sign, text }: { readonly sign: "+" | "-"; readonly text: string }): string {
  let color: "green" | "red" = "green";

  if (sign === "-") {
    color = "red";
  }

  return styleText(color, `  ${sign} ${text}`);
}

/** The command to run next, below what a command did. */
function formatNext({ command }: { readonly command: string }): string {
  return `\n${styleText("dim", "  next  ")}${command}`;
}

/** `text` broken at spaces into lines of at most `width` characters. */
function wrap({ text, width }: { readonly text: string; readonly width: number }): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
      continue;
    }

    line = line === "" ? word : `${line} ${word}`;
  }

  return [...lines, line];
}

/** Columns an error is wrapped to: the terminal's, capped so a wide one stays readable. */
const ERROR_WIDTH = 100;

/**
 * Print a {@link MockError} on stderr: the summary in red, then `why` and `fix`
 * as two labelled blocks whose lines all start in one column. `why` is prose
 * and is wrapped; `fix` holds commands and keeps its own line breaks.
 */
function printError({ error }: { readonly error: MockError }): void {
  const stream = process.stderr;
  const label = "  why  ";
  const indent = " ".repeat(label.length);
  const width = Math.min(stream.columns ?? ERROR_WIDTH, ERROR_WIDTH) - label.length;

  console.error(`${styleText(["red", "bold"], "✗ eve-mocks", { stream })}  ${styleText("bold", error.summary, { stream })}\n`);

  for (const [name, lines] of [
    ["why", wrap({ text: error.why, width })],
    ["fix", error.fix.split("\n")],
  ] as const) {
    for (const [index, line] of lines.entries()) {
      let prefix = indent;

      if (index === 0) {
        prefix = styleText("dim", `  ${name}  `, { stream });
      }

      console.error(`${prefix}${line}`.trimEnd());
    }
  }

  if (error.link !== undefined) {
    console.error(`${styleText("dim", "  docs ", { stream })}${error.link}`);
  }
}

/**
 * Print what was mocked, what went to a real upstream, and what was blocked.
 *
 * One titled block on stderr, in the icons and colours of `list`: a tree of
 * outcome, upstream, and MCP tool, each with its count. The title tells the
 * block apart from the wrapped command's own output, so its rows need no prefix.
 *
 * @param input.notes - Text after a target's count, by target: the connection a blocked host belongs to.
 */
function printReport({
  report,
  notes,
}: {
  readonly report: Report;
  readonly notes: ReadonlyMap<string, string>;
}): void {
  const stream = process.stderr;
  const total = report.counts.mock + report.counts.allow + report.counts.block;
  let headline = `${formatCount({ count: total, noun: "call" })}, no block`;

  if (report.counts.block > 0) {
    headline = `${formatCount({ count: total, noun: "call" })}, ${report.counts.block} block`;
  }

  if (total === 0) {
    headline = "no upstream call was made";
  }

  console.error(`\n${styleText("bold", `${MARK} eve-mocks`, { stream })}  ${styleText("dim", headline, { stream })}\n`);

  // A tree: outcome, then upstream, then MCP tool. Every count shares one column.
  const groups = (["mock", "allow", "block"] as const).flatMap((outcome) => {
    const rows = report.targets
      .filter((entry) => {
        return entry.outcome === outcome;
      })
      .map(({ target, calls, tools = {} }) => {
        const children = Object.entries(tools).sort(([, a], [, b]) => {
          return b - a;
        });
        const named = children.reduce((sum, [, count]) => {
          return sum + count;
        }, 0);

        // Requests that named no tool, such as `initialize` and `tools/list`, so the children add up.
        if (children.length > 0 && calls > named) {
          children.push([OTHER, calls - named]);
        }

        return { target, calls, children };
      });

    if (rows.length === 0) {
      return [];
    }

    return [{ outcome, rows }];
  });

  const width = Math.max(
    ...groups.flatMap(({ rows }) => {
      return rows.flatMap(({ target, children }) => {
        return [
          BRANCH.length + target.length,
          ...children.map(([tool]) => {
            return BRANCH.length * 2 + tool.length;
          }),
        ];
      });
    }),
    // Widest outcome label: `✓ allow`.
    7,
  );

  for (const [groupIndex, { outcome, rows }] of groups.entries()) {
    if (groupIndex > 0) {
      console.error("");
    }

    console.error(
      `  ${formatOutcome({ outcome, width, stream })}  ${styleText("bold", String(report.counts[outcome]).padStart(4), { stream })}`,
    );

    for (const [rowIndex, { target, calls, children }] of rows.entries()) {
      // The last row of a group closes its line, and its tools hang below a blank instead of a trunk.
      let branch = BRANCH;
      let trunk = TRUNK;

      if (rowIndex === rows.length - 1) {
        branch = LAST_BRANCH;
        trunk = " ".repeat(TRUNK.length);
      }

      const gap = " ".repeat(width - branch.length - target.length);
      const note = styleText("dim", notes.get(target) ?? "", { stream });

      console.error(`  ${styleText("dim", branch, { stream })}${target}${gap}  ${String(calls).padStart(4)}   ${note}`.trimEnd());

      for (const [childIndex, [tool, count]] of children.entries()) {
        let prefix = `${trunk}${BRANCH}`;

        if (childIndex === children.length - 1) {
          prefix = `${trunk}${LAST_BRANCH}`;
        }

        const name = `${tool}${" ".repeat(width - prefix.length - tool.length)}  ${String(count).padStart(4)}`;

        console.error(`  ${styleText("dim", `${prefix}${name}`, { stream })}`);
      }
    }
  }

  if (total > 0) {
    console.error("");
  }

  console.error(styleText("dim", `  ${"report".padEnd(12)}${join(STATE_DIR, "report.json")}`, { stream }));
}

/**
 * The eve connection each blocked host belongs to, by host. Best effort, for
 * the hint only: without a compiled manifest, or when a connection module does
 * not load, the hosts are reported without a connection.
 */
async function findConnections({ hosts }: { readonly hosts: readonly string[] }): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  // Resolving imports the app's connection modules: only worth it when there is something to explain.
  if (hosts.length === 0) {
    return found;
  }

  try {
    const connections = await resolveConnections({ connections: readManifest({ root: process.cwd() }) });

    for (const { name, url } of connections) {
      if (url !== undefined && hosts.includes(new URL(url).host)) {
        found.set(new URL(url).host, name);
      }
    }
  } catch {
    // The hint is optional; the run's own result must not depend on it.
  }

  return found;
}

/**
 * The error for a run that made blocked calls, with one fix per blocked host:
 * the commands for a host that is an eve connection, else the file to write.
 */
function createBlockError({
  report,
  connections,
}: {
  readonly report: Report;
  readonly connections: ReadonlyMap<string, string>;
}): MockError {
  const stream = process.stderr;

  // Per blocked host: its name, then the two ways out, labelled in the colours of their outcomes.
  const fixes = report.targets
    .filter(({ outcome }) => {
      return outcome === "block";
    })
    .flatMap(({ target, url }) => {
      const { protocol, host } = new URL(url);
      const connection = connections.get(target);
      const file = `mocks/${connection ?? "<name>"}.ts`;
      let mock = `${file}: export default defineHttpMock({ url: "${protocol}//${host}/" })`;

      if (connection !== undefined) {
        mock = `eve-mocks add ${connection} && eve-mocks pull ${connection}`;
      }

      return [
        styleText("bold", target, { stream }),
        `  ${styleText(OUTCOME_COLORS.mock, "mock it ", { stream })}  ${mock}`,
        `  ${styleText(OUTCOME_COLORS.allow, "allow it", { stream })}  ${file}: export default allow({ url: "${protocol}//${host}/" })`,
        "",
      ];
    });

  return createError({
    status: 403,
    message: `${formatCount({ count: report.counts.block, noun: "block" })} failed the run`,
    why: "The command succeeded, but the agent called an upstream that is neither mocked nor allowed, and a model that recovers from the thrown error would hide that",
    fix: [...fixes, `To let such a run pass, add ${ALLOW_BLOCK_FLAG}`].join("\n"),
  });
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
const ALLOW_BLOCK_FLAG = "--no-fail-on-block";

/** A free loopback port, for the evals' mock server. Freed again before the command starts, so a race is possible but unlikely. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();

      probe.close(() => {
        if (address === null || typeof address === "string") {
          reject(new Error("No port"));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

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

    printError({ error });
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
  shouldFailOnBlock,
}: {
  readonly dir: string;
  readonly command: readonly string[];
  readonly shouldFailOnBlock: boolean;
}): Promise<void> {
  const [file, ...args] = command.filter((arg) => {
    return arg !== MOCKS_FLAG && arg !== ALLOW_BLOCK_FLAG;
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

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EVE_MOCKS_DIR: dir,
    EVE_MOCKS_LOG: log,
    // Where an eval's mock(t, …) listens; the mocks in the dev server post intercepted calls there.
    [PORT_ENV]: String(await getFreePort()),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${PRELOAD.href}`].filter(Boolean).join(" "),
    // Bun ignores NODE_OPTIONS. See https://bun.com/docs/runtime/bunfig#preload
    BUN_OPTIONS: [process.env.BUN_OPTIONS, `--preload=${fileURLToPath(PRELOAD)}`].filter(Boolean).join(" "),
  };

  if (isEveDevCommand({ command: [file, ...args] })) {
    // eve's TUI talks to Vercel for its own credential gate and telemetry;
    // those are not agent upstreams. The preload allows them only when this is set.
    env.EVE_MOCKS_EVE_DEV = "1";
  }

  const child = start({
    file,
    args,
    env,
  });

  child.on("exit", async (code) => {
    const exitCode = code ?? 1;
    const report = writeReport({ root, log, command: [file, ...args], startedAt, exitCode });
    const blocked = report.targets.filter(({ outcome }) => {
      return outcome === "block";
    });
    const connections = await findConnections({
      hosts: blocked.map(({ target }) => {
        return target;
      }),
    });

    printReport({
      report,
      notes: new Map([
        [SIGN_IN, "answered by default"],
        [EVE_DEV, "allowed by default under eve dev"],
        ...[...connections].map(([host, name]): [string, string] => {
          return [host, `connection "${name}"`];
        }),
      ]),
    });

    if (exitCode === 0 && blocked.length > 0 && shouldFailOnBlock && !command.includes(ALLOW_BLOCK_FLAG)) {
      console.error("");
      printError({ error: createBlockError({ report, connections }) });
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
    console.error("");
    printError({ error: missing });
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

  // One outcome per line: side by side they outgrow an 80 column terminal.
  console.log(styleText("dim", `under ${MOCKS_FLAG}`));

  for (const outcome of ["mock", "allow", "block"] as const) {
    console.log(`  ${formatOutcome({ outcome, width: 10 })}${styleText("dim", OUTCOME_LEGEND[outcome])}`);
  }
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

/** Tool names `pull` prints before it sums up the rest: a hosted server lists dozens. */
const LISTED_TOOLS = 12;

/** Tool names per printed line. */
const TOOL_COLUMNS = 3;

/** Tool names of a pulled `tools/list` file; none for any other document, such as an OpenAPI spec. */
function readToolNames({ path }: { readonly path: string }): string[] {
  try {
    const { tools } = JSON.parse(readFileSync(path, "utf8")) as { readonly tools?: readonly { readonly name: string }[] };

    return (tools ?? []).map(({ name }) => {
      return name;
    });
  } catch {
    return [];
  }
}

/**
 * Print what one mock pulled: its name, the tools of a `tools/list`, what the
 * inspector's schema lint counted, one count per line, and the files written.
 */
function printPulled({
  name,
  paths,
  lint,
}: {
  readonly name: string;
  readonly paths: readonly string[];
  readonly lint: PullLint | undefined;
}): void {
  if (paths.length === 0) {
    console.log(`${styleText("bold", name)}  ${styleText("dim", "skipped: nothing remote to pull")}`);
    return;
  }

  const tools = paths.flatMap((path) => {
    return readToolNames({ path });
  });
  let title = styleText("bold", name);

  if (tools.length > 0) {
    title = `${title}  ${styleText("dim", formatCount({ count: tools.length, noun: "tool" }))}`;
  }

  console.log(title);

  const listed = tools.slice(0, LISTED_TOOLS);
  const column =
    Math.max(
      0,
      ...listed.map((tool) => {
        return tool.length;
      }),
    ) + 2;

  for (let index = 0; index < listed.length; index += TOOL_COLUMNS) {
    const line = listed
      .slice(index, index + TOOL_COLUMNS)
      .map((tool) => {
        return tool.padEnd(column);
      })
      .join("");

    console.log(`  ${line}`.trimEnd());
  }

  if (tools.length > listed.length) {
    console.log(styleText("dim", `  … and ${tools.length - listed.length} more`));
  }

  if (lint !== undefined) {
    const paint = (count: number, color: "red" | "yellow"): string => {
      return count > 0 ? styleText(color, String(count)) : styleText("dim", String(count));
    };

    console.log("");
    console.log(`${styleText("dim", "  errors    ")}${paint(lint.errors, "red")}`);
    console.log(`${styleText("dim", "  warnings  ")}${paint(lint.warnings, "yellow")}${styleText("dim", "  schema portability, from the MCP inspector")}`);
  }

  console.log("");

  for (const path of paths) {
    console.log(styleText("dim", `  saved     ${formatPath({ path })}`));
  }
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
      let lint: PullLint | undefined;
      const paths =
        (await entry.mock.pull?.({
          name: entry.name,
          headers,
          onLint: (found) => {
            lint = found;
          },
        })) ?? [];

      printPulled({ name: entry.name, paths, lint });
    } catch (error) {
      if (!(error instanceof MockError)) {
        throw error;
      }

      hasFailed = true;
      console.error(styleText("bold", entry.name, { stream: process.stderr }));
      printError({ error });
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
  console.log(formatDiff({ sign: "+", text: formatPath({ path }) }));

  if (connection.protocol === "mcp") {
    console.log(formatNext({ command: `eve-mocks pull ${name}` }));
  }
}

/** Create the mocks folder and route the app's eve scripts through `eve-mocks --`. */
function init({ dir }: { readonly dir: string }): void {
  let hasChanged = false;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(formatDiff({ sign: "+", text: `${formatPath({ path: dir })}/` }));
    hasChanged = true;
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
  const skipped: string[] = [];
  let hasTitle = false;

  for (const name of PROXIED_SCRIPTS) {
    const script = scripts[name];

    if (script === undefined || script.startsWith("eve-mocks ")) {
      continue;
    }

    // The shell splits a chained script before this CLI runs, so only its
    // first command would be wrapped.
    if (script.includes("&&") || script.includes(";") || script.includes("|")) {
      skipped.push(name);
      continue;
    }

    scripts[name] = `eve-mocks -- ${script}`;

    // The file name once, above the first changed line, the way a diff names its file.
    if (!hasTitle) {
      console.log(`${hasChanged ? "\n" : ""}${styleText("bold", "  package.json")}`);
      hasTitle = true;
    }

    console.log(formatDiff({ sign: "-", text: `"${name}": ${JSON.stringify(script)}` }));
    console.log(formatDiff({ sign: "+", text: `"${name}": ${JSON.stringify(scripts[name])}` }));
    hasChanged = true;
  }

  for (const name of skipped) {
    console.log(`${styleText("yellow", "  ! ")}script ${name} chains commands: wrap the one that starts eve with eve-mocks -- by hand`);
  }

  if (!hasChanged) {
    console.log(styleText("dim", "  nothing to do: the mocks folder exists and the scripts are wrapped"));
    return;
  }

  manifest.scripts = scripts;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(formatNext({ command: "eve-mocks list" }));
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
      (["mock", "allow", "block"] as const)
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
    printError({ error });
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
      // For --no-fail-on-block. See https://nodejs.org/api/util.html#utilparseargsconfig
      allowNegative: true,
      tokens: true,
      options: {
        dir: { type: "string", default: "mocks" },
        header: { type: "string", multiple: true, default: [] },
        json: { type: "boolean", default: false },
        "fail-on-block": { type: "boolean", default: true },
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
    await run({ dir, command: positionals, shouldFailOnBlock: values["fail-on-block"] });
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

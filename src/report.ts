import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CallRecord } from "./types.ts";

/** Folder eve-mocks keeps its run artefacts in, relative to the app root. It ignores itself in git. */
export const STATE_DIR = ".eve-mocks";

/** Runs (call log and report) kept in {@link STATE_DIR}; older ones are deleted when a run starts. */
const KEPT_RUNS = 10;

/** Calls to one target with one outcome. */
export type TargetCount = {
  /** `mocked`, `allowed`, or `blocked`. */
  readonly outcome: CallRecord["outcome"];
  /** Name of the mock or allow entry that matched, else the host that was called. */
  readonly target: string;
  /** Number of calls. */
  readonly calls: number;
  /** First URL called, so a blocked target can be turned into a mock or an allow entry. */
  readonly url: string;
  /** Calls per MCP tool, for a target whose calls named one. */
  readonly tools?: Readonly<Record<string, number>>;
};

/** What one run under `--mocks` did, as written to `.eve-mocks/report.json`. */
export type Report = {
  /** The wrapped command, without the eve-mocks flags. */
  readonly command: readonly string[];
  /** ISO time the run started. */
  readonly startedAt: string;
  /** Exit code of the wrapped command, before eve-mocks turned blocked calls into a failure. */
  readonly exitCode: number;
  /** Calls per outcome. */
  readonly counts: Readonly<Record<CallRecord["outcome"], number>>;
  /** Calls per outcome and target, most calls first. */
  readonly targets: readonly TargetCount[];
  /** Path of the call log, one JSON {@link CallRecord} per line. */
  readonly log: string;
};

/**
 * Create the state folder and an empty call log for one run.
 *
 * The folder holds a `.gitignore` that ignores everything in it, so an app
 * does not have to touch its own. Each run gets its own log: a dev server and
 * an eval can run side by side without mixing their calls.
 *
 * @param input.root - App root.
 * @param input.startedAt - Start of the run; names the log.
 * @returns Absolute path of the call log.
 */
export function createLog({ root, startedAt }: { readonly root: string; readonly startedAt: Date }): string {
  const runs = join(root, STATE_DIR, "runs");

  mkdirSync(runs, { recursive: true });

  const ignore = join(root, STATE_DIR, ".gitignore");

  if (!existsSync(ignore)) {
    writeFileSync(ignore, "*\n");
  }

  // ISO names sort by time, so the oldest runs come first. A run is a `.jsonl` log and its `.json` report.
  const stale = readdirSync(runs)
    .filter((name) => {
      return name.endsWith(".jsonl");
    })
    .sort()
    .slice(0, -(KEPT_RUNS - 1));

  for (const name of stale) {
    rmSync(join(runs, name), { force: true });
    rmSync(join(runs, name.replace(/l$/, "")), { force: true });
  }

  // A colon is not valid in a Windows file name.
  const log = join(runs, `${startedAt.toISOString().replaceAll(":", "-")}-${process.pid}.jsonl`);

  writeFileSync(log, "");

  return log;
}

/** Every call the preload appended to `log`. */
function readCalls({ log }: { readonly log: string }): CallRecord[] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => {
      return line !== "";
    })
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CallRecord];
      } catch {
        // A process killed mid-append leaves half a line; the other calls still count.
        return [];
      }
    });
}

/**
 * Summarise a run's call log and write it next to the log, as
 * `.eve-mocks/runs/<start>.json`, and to `.eve-mocks/report.json`, which always
 * holds the latest run.
 */
export function writeReport({
  root,
  log,
  command,
  startedAt,
  exitCode,
}: {
  readonly root: string;
  readonly log: string;
  readonly command: readonly string[];
  readonly startedAt: Date;
  readonly exitCode: number;
}): Report {
  const counts = { mocked: 0, allowed: 0, blocked: 0 };
  const byTarget = new Map<
    string,
    { outcome: CallRecord["outcome"]; target: string; calls: number; url: string; tools: Record<string, number> }
  >();

  for (const { outcome, target, tool, url } of readCalls({ log })) {
    const key = `${outcome} ${target}`;
    const entry = byTarget.get(key) ?? { outcome, target, calls: 0, url, tools: {} };

    counts[outcome] += 1;
    entry.calls += 1;

    if (tool !== undefined) {
      entry.tools[tool] = (entry.tools[tool] ?? 0) + 1;
    }

    byTarget.set(key, entry);
  }

  const targets = [...byTarget.values()]
    .sort((a, b) => {
      return b.calls - a.calls;
    })
    .map(({ tools, ...rest }): TargetCount => {
      if (Object.keys(tools).length === 0) {
        return rest;
      }

      return { ...rest, tools };
    });

  const report: Report = { command, startedAt: startedAt.toISOString(), exitCode, counts, targets, log };

  const json = `${JSON.stringify(report, null, 2)}\n`;

  writeFileSync(log.replace(/l$/, ""), json);
  writeFileSync(join(root, STATE_DIR, "report.json"), json);

  return report;
}

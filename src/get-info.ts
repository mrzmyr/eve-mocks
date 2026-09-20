import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { MockError } from "./errors.ts";
import { readJson } from "./read-json.ts";
import { getCoverage, type CoverageStatus } from "./get-coverage.ts";
import { loadMocks } from "./load-mocks.ts";
import { MANIFEST_PATH, readManifest } from "./read-manifest.ts";
import { resolveConnections } from "./resolve-connections.ts";

/** What `eve-mocks info` reports. */
export type Info = {
  /** Version of eve-mocks. */
  readonly version: string;
  /** Runtime the CLI runs on, such as `node v24.11.0`. */
  readonly runtime: string;
  /** The mocks directory and what it declares. */
  readonly mocksDir: { readonly path: string; readonly exists: boolean; readonly mocks: number; readonly allowed: number };
  /** eve's compiled manifest. `version` is absent when the file is missing or unreadable. */
  readonly manifest: { readonly path: string; readonly exists: boolean; readonly version?: number };
  /** Installed eve version, when the app resolves one. */
  readonly eve?: string;
  /** eve connections by what a call to them does; all zero without a manifest. */
  readonly counts: Readonly<Record<CoverageStatus, number>>;
  /** What is missing or broken, each with its fix. Empty for a working setup. */
  readonly problems: readonly string[];
};

/** Version field of a package.json, if the file is there and has one. */
function readVersion({ path }: { readonly path: string }): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  const { version } = readJson({ path, fix: "Reinstall the package" }) as { readonly version?: unknown };

  if (typeof version === "string") {
    return version;
  }

  return undefined;
}

/** Installed eve version, resolved the way the app resolves `eve`. */
function getEveVersion({ root }: { readonly root: string }): string | undefined {
  try {
    // eve exports no package.json subpath, so resolve its folder through Node's lookup paths.
    const require = createRequire(join(root, "package.json"));
    const [folder] = (require.resolve.paths("eve") ?? []).filter((path) => {
      return existsSync(join(path, "eve/package.json"));
    });

    if (folder === undefined) {
      return undefined;
    }

    return readVersion({ path: join(folder, "eve/package.json") });
  } catch {
    return undefined;
  }
}

/**
 * Collect the setup eve-mocks sees, without changing anything.
 *
 * A broken part does not throw: it lands in `problems` with its fix, so one
 * call shows everything that is wrong.
 *
 * @param input.root - App root, where `.eve/` and `package.json` live.
 * @param input.dir - Absolute path of the mocks directory.
 */
export async function getInfo({ root, dir }: { readonly root: string; readonly dir: string }): Promise<Info> {
  const problems: string[] = [];
  const counts: Record<CoverageStatus, number> = { mock: 0, allow: 0, block: 0 };
  let loaded: Awaited<ReturnType<typeof loadMocks>> = { mocks: [], allowed: [] };

  /** Record an operator error as a problem; anything else is a defect and surfaces. */
  function note({ error }: { readonly error: unknown }): void {
    if (!(error instanceof MockError)) {
      throw error;
    }

    problems.push(`${error.summary}. Fix: ${error.fix}`);
  }

  try {
    loaded = await loadMocks({ dir });
  } catch (error) {
    note({ error });
  }

  const manifestPath = join(root, MANIFEST_PATH);
  let manifestVersion: number | undefined;

  try {
    const connections = await resolveConnections({ connections: readManifest({ root }) });

    for (const row of getCoverage({ connections, ...loaded })) {
      if (row.isConnection) {
        counts[row.status] += 1;
      }
    }

    const { version } = readJson({ path: manifestPath, fix: "Recompile the app with `eve info`" }) as {
      readonly version?: unknown;
    };

    if (typeof version === "number") {
      manifestVersion = version;
    }
  } catch (error) {
    note({ error });
  }

  const eve = getEveVersion({ root });
  const runtime = `${process.release.name} ${process.version}`;

  return {
    version: readVersion({ path: join(import.meta.dirname, "../package.json") }) ?? "unknown",
    runtime,
    mocksDir: { path: dir, exists: existsSync(dir), mocks: loaded.mocks.length, allowed: loaded.allowed.length },
    manifest: {
      path: manifestPath,
      exists: existsSync(manifestPath),
      ...(manifestVersion !== undefined && { version: manifestVersion }),
    },
    ...(eve !== undefined && { eve }),
    counts,
    problems,
  };
}

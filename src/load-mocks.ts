import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { createError } from "./errors.ts";
import type { Allowed, Mock } from "./types.ts";

/** A mock with the name of the file that defines it. */
export type NamedMock = {
  /** File name without extension, such as `tracker`. */
  readonly name: string;
  /** The mock the file default-exports. */
  readonly mock: Mock;
};

/** Everything the mocks directory declares. */
export type LoadedMocks = {
  /** Upstreams answered in-process. */
  readonly mocks: readonly NamedMock[];
  /** Real upstreams that stay reachable. */
  readonly allowed: readonly Allowed[];
};

/** Extensions a mock file can have. */
const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

/** Whether `value` has the shape `defineHttpMock` and its siblings return. */
function isMock(value: unknown): value is Mock {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "handle" in value &&
    typeof value.handle === "function"
  );
}

/** Whether `value` is what `allow` returns. */
function isAllowed(value: unknown): value is Allowed {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "isAllowed" in value &&
    value.isAllowed === true
  );
}

/**
 * Load every mock file at the top level of `dir`. Subfolders are skipped, so
 * fixtures, specs, and tests can live next to the mocks.
 *
 * @param input.dir - Absolute path of the mocks directory.
 * @throws MockError when `dir` is missing or a file's default export is not a
 *   mock, an allow entry, or an array of them.
 */
export async function loadMocks({ dir }: { readonly dir: string }): Promise<LoadedMocks> {
  if (!existsSync(dir)) {
    throw createError({
      status: 404,
      message: `Mocks directory ${dir} does not exist`,
      why: "eve-mocks loads one mock per file from this directory",
      fix: "Create it with: eve-mocks init, or pass another one with --dir",
    });
  }

  const mocks: NamedMock[] = [];
  const allowed: Allowed[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const extension = extname(entry.name);

    if (
      !entry.isFile() ||
      !EXTENSIONS.includes(extension) ||
      entry.name.endsWith(".d.ts") ||
      entry.name.includes(".test.")
    ) {
      continue;
    }

    const module = (await import(pathToFileURL(join(dir, entry.name)).href)) as {
      readonly default?: unknown;
    };
    const entries = [module.default].flat();
    const isValid = entries.every((entry) => {
      return isMock(entry) || isAllowed(entry);
    });

    if (!isValid) {
      throw createError({
        status: 500,
        message: `${entry.name} does not default-export a mock or an allow entry`,
        why: "Every top-level file in the mocks directory must default-export mocks, allow entries, or an array of them",
        fix: "Export the result of defineMcpMock, defineHttpMock, or allow, or move the file into a subfolder",
      });
    }

    for (const item of entries) {
      if (isAllowed(item)) {
        allowed.push(item);
      } else if (isMock(item)) {
        mocks.push({ name: basename(entry.name, extension), mock: item });
      }
    }
  }

  return { mocks, allowed };
}

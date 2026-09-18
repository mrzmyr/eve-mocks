import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createError } from "./errors.ts";

/**
 * Absolute path of a snapshot a mock file names. A relative string is relative
 * to the mocks directory, so `"./snapshots/notion.openapi.json"` means the same
 * in every process, whatever its working directory.
 *
 * @throws MockError when a relative path is used outside the eve-mocks CLI
 *   and preload, which are what set `EVE_MOCKS_DIR`.
 */
export function resolvePath({ path }: { readonly path: string | URL }): string {
  if (path instanceof URL) {
    return fileURLToPath(path);
  }

  if (isAbsolute(path)) {
    return path;
  }

  const { EVE_MOCKS_DIR } = process.env;

  if (EVE_MOCKS_DIR === undefined) {
    throw createError({
      status: 500,
      message: `Cannot resolve ${path}`,
      why: "A relative snapshot path is resolved against the mocks directory, and EVE_MOCKS_DIR is not set",
      fix: "Load the mock through the eve-mocks CLI, or pass a file URL built from import.meta.url",
    });
  }

  return join(EVE_MOCKS_DIR, path);
}

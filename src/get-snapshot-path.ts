import { join } from "node:path";

import { createError } from "./errors.ts";

/** Folder inside the mocks directory that holds what `eve-mocks pull` writes. */
const SNAPSHOTS_DIR = "snapshots";

/**
 * Where a mock's snapshot lives: `<mocks>/snapshots/<name>.<kind>.json`.
 * Derived from the mock's file name, so a mock file never spells a path and
 * `pull`, `check`, and the preload agree on it in every process.
 *
 * @param input.name - The mock's file name without extension.
 * @param input.kind - `openapi` for a REST spec, `tools` for an MCP `tools/list`.
 * @throws MockError when `EVE_MOCKS_DIR` is unset, which only the eve-mocks
 *   CLI and its wrapper set.
 */
export function getSnapshotPath({
  name,
  kind,
}: {
  readonly name: string;
  readonly kind: "openapi" | "tools";
}): string {
  const { EVE_MOCKS_DIR } = process.env;

  if (EVE_MOCKS_DIR === undefined) {
    throw createError({
      status: 500,
      message: `Cannot locate the snapshot of ${name}`,
      why: "Snapshots live in the mocks directory, and EVE_MOCKS_DIR is not set",
      fix: "Load the mock through the eve-mocks CLI or its wrapper",
    });
  }

  return join(EVE_MOCKS_DIR, SNAPSHOTS_DIR, `${name}.${kind}.json`);
}

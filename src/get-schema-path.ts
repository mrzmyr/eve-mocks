import { join } from "node:path";

import { getMocksDir } from "./get-mocks-dir.ts";

/** Folder inside the mocks directory that holds what `eve-mocks pull` writes. */
const SCHEMAS_DIR = "schemas";

/**
 * Where a pulled schema lives: `<mocks>/schemas/<name>.<kind>.json`.
 * Derived from the mock's file name, so a mock file never spells a path and
 * `pull`, `check`, and the preload agree on it in every process.
 *
 * @param input.name - The mock's file name without extension.
 * @param input.kind - `openapi` for an HTTP API's OpenAPI document, `tools` for an MCP `tools/list`.
 * @throws MockError when `EVE_MOCKS_DIR` is unset, which only the eve-mocks
 *   CLI and its wrapper set.
 */
export function getSchemaPath({
  name,
  kind,
}: {
  readonly name: string;
  readonly kind: "openapi" | "tools";
}): string {
  return join(getMocksDir({ name }), SCHEMAS_DIR, `${name}.${kind}.json`);
}

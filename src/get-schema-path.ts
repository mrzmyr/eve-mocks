import { join } from "node:path";

import { getMocksDir } from "./get-mocks-dir.ts";

/** Folder inside the mocks directory that holds what `eve-mocks pull` writes. */
const SCHEMAS_DIR = "schemas";

/**
 * Where a pulled schema lives: `<mocks>/schemas/<name>.json`.
 *
 * Derived from the mock's file name, so a mock file never spells a path and
 * `pull`, `check`, and the preload agree on it in every process. The name says
 * nothing about the content: a mock has one type, and an MCP server may later
 * be pulled for more than its tools.
 *
 * @param input.name - The mock's file name without extension.
 * @throws MockError when `EVE_MOCKS_DIR` is unset, which only the eve-mocks
 *   CLI and its wrapper set.
 */
export function getSchemaPath({ name }: { readonly name: string }): string {
  return join(getMocksDir({ name }), SCHEMAS_DIR, `${name}.json`);
}

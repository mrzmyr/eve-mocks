import { createError } from "./errors.ts";

/**
 * The app's mocks directory, which schema files and local specs resolve against.
 *
 * @param input.name - The mock asking, named in the error.
 * @throws MockError when `EVE_MOCKS_DIR` is unset, which only the eve-mocks
 *   CLI and its wrapper set.
 */
export function getMocksDir({ name }: { readonly name: string }): string {
  const { EVE_MOCKS_DIR } = process.env;

  if (EVE_MOCKS_DIR === undefined) {
    throw createError({
      status: 500,
      message: `Cannot locate the schema of ${name}`,
      why: "Schemas live in the mocks directory, and EVE_MOCKS_DIR is not set",
      fix: "Load the mock through the eve-mocks CLI or its wrapper",
    });
  }

  return EVE_MOCKS_DIR;
}

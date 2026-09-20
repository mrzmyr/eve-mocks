import { readFileSync } from "node:fs";

import { createError } from "./errors.ts";

/**
 * Parse a JSON file that must exist.
 *
 * @param input.path - File to read.
 * @param input.fix - How the operator gets a valid file back, such as the command that writes it.
 * @throws MockError 422 when the file cannot be read or is not JSON.
 */
export function readJson({ path, fix }: { readonly path: string; readonly fix: string }): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    let why = String(cause);

    if (cause instanceof Error) {
      why = cause.message;
    }

    throw createError({ status: 422, message: `Cannot read ${path} as JSON`, why, fix, cause });
  }
}

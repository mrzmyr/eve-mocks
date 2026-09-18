import type { Allowed } from "./types.ts";

/**
 * Let requests to a real upstream through while the mocks are on, such as the
 * model gateway. Under `--mocks` every other unmocked request throws.
 *
 * @param input.url - URL prefix that may be reached.
 */
export function allow({ url }: { readonly url: string }): Allowed {
  return { url, isAllowed: true };
}

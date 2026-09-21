import { basename } from "node:path";

/**
 * Name of eve's control plane and telemetry in the call log and the run
 * summary.
 *
 * These hosts are eve's own machinery, not the agent's upstreams. They are
 * allowed only under `eve dev`, and only after mocks, user allow entries, and
 * the sign-in default have all declined.
 */
export const EVE_DEV = "eve-dev";

/**
 * URL prefixes of eve's control plane and CLI telemetry. Prefixes, so a path
 * on either host matches; https only, as observed from `eve dev`.
 */
const EVE_DEV_PREFIXES = ["https://api.vercel.com/", "https://telemetry.vercel.com/"] as const;

/**
 * Whether `url` is eve's own control plane or CLI telemetry.
 *
 * Allowed only under `eve dev`, and only after mocks, user allow entries, and
 * the sign-in default have all declined, so a connection sign-in to
 * `api.vercel.com/v1/connect/token/` still gets mock-token.
 */
export function isEveDevUrl({ url }: { readonly url: string }): boolean {
  return EVE_DEV_PREFIXES.some((prefix) => {
    return url.startsWith(prefix);
  });
}

/**
 * Whether the wrapped command is `eve dev`.
 *
 * A token whose path basename is exactly `eve` must be immediately followed by
 * `dev`. The CLI calls this after `--mocks` and `--no-fail-on-block` are
 * stripped, and sets `EVE_MOCKS_EVE_DEV` so the preload can allow eve's own
 * control plane and telemetry — only under that command, and only after mocks,
 * user allow entries, and the sign-in default have all declined.
 */
export function isEveDevCommand({ command }: { readonly command: readonly string[] }): boolean {
  for (const [index, token] of command.entries()) {
    if (basename(token) !== "eve") {
      continue;
    }

    if (command[index + 1] !== "dev") {
      continue;
    }

    return true;
  }

  return false;
}

import type { Mock } from "./types.ts";

/**
 * Unsigned OIDC token that expires in 2100.
 *
 * `@vercel/connect` reads `VERCEL_OIDC_TOKEN` before it calls the token
 * endpoint and refreshes it through the Vercel CLI when absent. The mocked
 * endpoint never checks it, so offline runs only need one that looks unexpired.
 */
const OFFLINE_OIDC_TOKEN = [
  btoa(JSON.stringify({ alg: "none", typ: "JWT" })),
  btoa(JSON.stringify({ sub: "mock", exp: 4_102_444_800 })),
  "",
].join(".");

/**
 * Mock Vercel Connect's token endpoint, so each connection's real `getToken`
 * runs and receives `mock-token` while no credential leaves the machine.
 * See https://vercel.com/docs/connect
 */
export function vercelConnect(): Mock {
  return {
    // A prefix, not a route: connector ids such as `mcp.linear.app/linear`
    // follow it and contain slashes.
    url: "https://api.vercel.com/v1/connect/token/",
    type: "http",
    env: { VERCEL_OIDC_TOKEN: OFFLINE_OIDC_TOKEN },
    handle: async () => {
      return Response.json({
        token: "mock-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        connector: { id: "mock-connector", uid: "mock-connector" },
      });
    },
  };
}

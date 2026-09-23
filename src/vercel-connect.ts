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
 * Vercel Connect's token prefix. Connector ids follow it and contain slashes.
 * See https://vercel.com/docs/connect
 */
export const CONNECT_URL = "https://api.vercel.com/v1/connect/token/";

/**
 * The built-in answer for {@link CONNECT_URL}. The sign-in default uses it;
 * a mock file is not required.
 * See https://vercel.com/docs/connect
 */
export function vercelConnect(): Mock {
  return {
    url: CONNECT_URL,
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

import { oauthToken } from "./oauth-token.ts";
import type { Mock } from "./types.ts";
import { CONNECT_URL, vercelConnect } from "./vercel-connect.ts";

/** Name of the default sign-in mock in the call log and the run summary. */
export const SIGN_IN = "sign-in";

/**
 * The Vercel Connect token endpoint, which eve connections sign in through.
 * Its URL is fixed, so it is recognised without looking at the request.
 */
const CONNECT = vercelConnect();

/**
 * Environment the sign-in code reads before it fetches. Applied where unset,
 * like a mock's own `env`.
 */
export const SIGN_IN_ENV = CONNECT.env ?? {};

/**
 * Whether `request` asks an OAuth 2.0 token endpoint for a token. Every grant
 * sends `grant_type`, as a form field or, with some providers, in a JSON body.
 * See https://datatracker.ietf.org/doc/html/rfc6749#section-4
 */
async function isTokenRequest({ request }: { readonly request: Request }): Promise<boolean> {
  if (request.method !== "POST") {
    return false;
  }

  // A clone: the caller may still hand the request to something else.
  const body = await request.clone().text();

  if (request.headers.get("content-type")?.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(body);

      return typeof parsed === "object" && parsed !== null && "grant_type" in parsed;
    } catch {
      return false;
    }
  }

  return new URLSearchParams(body).has("grant_type");
}

/**
 * Whether an allow entry claims `requestUrl`.
 *
 * A request under {@link CONNECT_URL} is claimed only by an allow of that
 * prefix or a narrower one. A wider allow, such as `https://api.vercel.com/`,
 * leaves the sign-in default to answer the token path.
 */
export function isAllowMatch({
  allowUrl,
  requestUrl,
}: {
  readonly allowUrl: string;
  readonly requestUrl: string;
}): boolean {
  if (!requestUrl.startsWith(allowUrl)) {
    return false;
  }

  if (!requestUrl.startsWith(CONNECT_URL)) {
    return true;
  }

  return allowUrl.startsWith(CONNECT_URL);
}

/**
 * The mock that answers `request` when it is a sign-in, so a connection's own
 * auth code runs without a mock file for its token endpoint.
 *
 * The caller asks only for a request that no mock and no allow entry claimed:
 * answering it locally can replace a blocked call, never a real one.
 *
 * @returns The mock to answer with, or undefined when the request is not a sign-in.
 */
export async function getSignIn({ request }: { readonly request: Request }): Promise<Mock | undefined> {
  if (request.url.startsWith(CONNECT.url)) {
    return CONNECT;
  }

  if (await isTokenRequest({ request })) {
    return oauthToken({ url: request.url });
  }

  return undefined;
}

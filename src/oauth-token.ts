import type { Mock } from "./types.ts";

/**
 * Mock an OAuth 2.0 token endpoint, such as an identity provider's `/oauth/token`, so
 * client-credentials code runs and receives `mock-token`.
 * See https://datatracker.ietf.org/doc/html/rfc6749#section-5.1
 *
 * @param input.url - The provider's token endpoint.
 */
export function oauthToken({ url }: { readonly url: string }): Mock {
  return {
    url,
    handle: async () => {
      return Response.json({ access_token: "mock-token", token_type: "Bearer", expires_in: 86_400 });
    },
  };
}

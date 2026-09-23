# Authentication

A connection signs in before it calls its upstream. That request is a call like
any other, so under `--mocks` it is mocked or it throws. eve-mocks answers the
two sign-ins eve connections use. The connection's own auth code runs unchanged
and receives `mock-token`, which a mocked upstream accepts. No client secret is
needed, locally or in CI.

The summary names that call `sign-in`:

```
❅ eve-mocks  4 calls, no block

  ✓ mock             4
  ├─ linear          3
  │  └─ get_issue    3
  └─ sign-in         1   answered by default
```

A mock file and an [allow](allow.md) entry are checked first. This answer runs
only for a call neither of them claimed, which is why allowing a token endpoint
still reaches the real one.

## Vercel Connect

eve connections sign in through [Vercel Connect](https://vercel.com/docs/connect).
The token URL is fixed, `https://api.vercel.com/v1/connect/token/`, so the
request is recognised from the URL alone. Connector ids follow that prefix and
still match.

The client expects Connect's body: `token`, `expiresAt`, and `connector`.
`@vercel/connect` reads `VERCEL_OIDC_TOKEN` before it fetches, and refreshes it
through the Vercel CLI when the variable is absent. When yours is unset, the
mock sets one that looks unexpired, so that refresh never starts and the
fetch can be answered. The mocked endpoint never checks the token.

Under a wrapped `eve dev`, `api.vercel.com` would otherwise pass through as
eve's own host. Sign-in is answered first, so the token endpoint still gets
`mock-token`.

An allow of the host does not include this path.
`allow({ url: "https://api.vercel.com/" })` lets the rest of that host through
and leaves the token endpoint mocked. An allow of the token prefix itself
still reaches the real endpoint.

## OAuth

Any other token endpoint has no fixed URL. Every OAuth 2.0 grant sends
`grant_type`, as a form field or in JSON, and that is how the request is
recognised. The answer is the token response the client already parses:
`access_token`, `token_type`, and `expires_in`.

A token endpoint that sends no `grant_type` never matches, so the call is
blocked. Name the URL:

```ts
// mocks/auth.ts
import { oauthToken } from "eve-mocks";

export default oauthToken({ url: "https://auth.example.com/token" });
```

Every request to that URL then gets `mock-token`, and the file wins over an
allow entry for the same host.

The function: [`oauthToken`](api/oauth-token.md). For a body the client does
not accept, pin the route with [`defineHttpMock`](api/define-http-mock.md).

Signing in to download a schema is [`pull`](mocks.md#protected-upstreams), on
your machine.

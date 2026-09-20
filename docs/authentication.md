# Authentication

You do not have to do anything. A connection signs in before it calls its
upstream, and eve-mocks answers that sign-in itself:

```
❅ eve-mocks  4 calls, none blocked

  ✓ mock      sign-in     1   answered by default
              linear      3   get_issue 3

  report      .eve-mocks/report.json
```

The connection's own auth code runs unchanged. It gets `mock-token`, and a
mocked upstream accepts any token. No client secret is needed, not locally and
not in CI.

## What counts as a sign-in

| Sign-in | Recognised by |
| --- | --- |
| [Vercel Connect](https://vercel.com/docs/connect) | its token endpoint, `api.vercel.com/v1/connect/token/` |
| any OAuth 2.0 token endpoint | `grant_type` in the request body, which [every grant sends](https://datatracker.ietf.org/doc/html/rfc6749#section-4) |

A sign-in is only answered when nothing else claims the request. A mock or an
[allow](allow.md) entry for the same URL wins, so allowing a token endpoint
still reaches the real one.

## A custom token endpoint

An endpoint that sends no `grant_type` is blocked like any other request. Mock
it by its URL:

```ts
// mocks/auth.ts
import { oauthToken } from "eve-mocks";

export default oauthToken({ url: "https://auth.example.com/token" });
```

It answers `{ access_token: "mock-token", token_type: "Bearer" }`. For another
shape, use [`defineHttpMock`](mocks.md#http) with a route.

Signing in to download a schema is a different topic:
[pull from a protected upstream](mocks.md#protected-upstreams).

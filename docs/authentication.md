# Authentication

A connection signs in before it calls its upstream: it asks a token endpoint
for a token, then sends that token along. Under `--mocks` the sign-in request is
blocked like any other:

```
eve-mocks  2 calls, 1 blocked

  ✗ blocked   auth.example.com     1

  report      .eve-mocks/report.json
```

Mock the token endpoint, and the connection's own auth code runs unchanged. It
gets `mock-token`, and the mocked upstream accepts any token.

```ts
// mocks/auth.ts
import { oauthToken } from "eve-mocks";

export default oauthToken({ url: "https://auth.example.com/oauth/token" });
```

```
eve-mocks  4 calls, none blocked

  ✓ mocked    auth       1
              linear     3   get_issue 3

  report      .eve-mocks/report.json
```

You change nothing in the connection, and no client secret is needed, not
locally and not in CI.

## Vercel Connect

A connection that gets its token from
[Vercel Connect](https://vercel.com/docs/connect) needs `vercelConnect()`
instead:

```ts
// mocks/vercel-connect.ts
import { vercelConnect } from "eve-mocks";

export default vercelConnect();
```

Signing in to download a schema is a different topic:
[pull from a protected upstream](mocks.md#protected-upstreams).

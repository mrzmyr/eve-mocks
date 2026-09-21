# FAQ

Start with [Mocks](mocks.md). These are the cases the basics do not cover.

<!-- site:accordion -->

### Do I have to mock a connection's sign-in?

No. A connection signs in before it calls its upstream, and eve-mocks answers
that sign-in itself. The connection's own auth code runs unchanged and gets
`mock-token`, which a mocked upstream accepts. No client secret is needed, not
locally and not in CI.

```
❅ eve-mocks  4 calls, no block

  ✓ mock             4
  ├─ linear          3
  │  └─ get_issue    3
  └─ sign-in         1   answered by default

  report      .eve-mocks/report.json
```

| Sign-in | Recognised by |
| --- | --- |
| [Vercel Connect](https://vercel.com/docs/connect) | its token endpoint, `api.vercel.com/v1/connect/token/` |
| any OAuth 2.0 token endpoint | `grant_type` in the request body, which [every grant sends](https://datatracker.ietf.org/doc/html/rfc6749#section-4) |

A mock or an [allow](allow.md) entry for the same URL wins, so allowing a token
endpoint still reaches the real one. Signing in to download a schema is a
different topic: [pull from a protected upstream](mocks.md#protected-upstreams).

### Why does eve dev reach api.vercel.com under --mocks?

`eve dev` is eve's interactive TUI. Its credential gate and CLI telemetry talk
to `api.vercel.com` and `telemetry.vercel.com`. Those are eve's own hosts, not
the agent's upstreams, so eve-mocks allows them by default when the wrapped
command is `eve dev`. They show in the run summary as `eve-dev`:

```
❅ eve-mocks  5 calls, no block

  → allow            5
  └─ eve-dev         5   allowed by default under eve dev

  report      .eve-mocks/report.json
```

A mock or an [allow](allow.md) entry for the same URL wins. To override, write
your own mock for the URL. The sign-in default still answers Vercel Connect
token requests, so a connection sign-in is never sent to the real endpoint.

### My token endpoint sends no `grant_type`. Why is it blocked?

Only a request with `grant_type` is recognised as a sign-in. Any other token
endpoint is blocked like every request. Mock it by its URL:

```ts
// mocks/auth.ts
import { oauthToken } from "eve-mocks";

export default oauthToken({ url: "https://auth.example.com/token" });
```

It answers `{ access_token: "mock-token", token_type: "Bearer" }`. For another
shape, use [`defineHttpMock`](mocks.md#http) with a route.

### Several connections share one host. How do I mock them?

Give `spec` an array. The operations are merged, and each document keeps its own
`components`, so a `$ref` resolves in the document that wrote it. Two documents
that declare the same method and path stop the run, naming both.

```ts
defineHttpMock({
  url: "https://api.shop.example.com",
  spec: ["../openapi/shop-orders.json", "../openapi/shop-catalog.json"],
});
```

### Can the mock read the same spec file as my connection?

Yes. A `spec` that is a path, relative to `mocks/`, is read in place and never
pulled. Keep the spec in a `.json` file, import it in the connection, and point
the mock at the same file: the two cannot drift.

```ts
// connection
import spec from "../../openapi/billing.json" with { type: "json" };

// mocks/billing.ts
defineHttpMock({ url: "https://billing.example.com", spec: "../openapi/billing.json" });
```

eve accepts only modules inside `lib/`, so keep the `.json` file outside it.

### An upstream has no OpenAPI spec. Can I still mock it?

Yes. Leave `spec` out and only the routes answer; everything else is a 404.

```ts
defineHttpMock({
  url: "https://legacy.example.com/",
  routes: { "/status": { GET: () => ({ ok: true }) } },
});
```

### Why is a tool missing from the mocked server?

The mock lists exactly the tools that have a result. Add a result for the tool
and it appears. eve filters tools by the connection's allow-list anyway, so a
tool without a result is one the model could not call.

### My client uses axios, got, or a gRPC SDK. Is it mocked?

It is blocked, not mocked. eve-mocks answers `fetch` only. Requests through
`node:http`, `node:https`, and `node:http2` throw unless their URL is allowed,
and they count as `block`. Call the upstream with `fetch` to mock it.

### `list` shows a dynamic connection without a URL. What now?

Its module builds the URL inside the `session.started` handler, so there is
nothing to read before a session. `add` cannot scaffold it; write
`mocks/<connection-name>.ts` by hand. The file name must equal the connection
name, because that is how it is matched. Calls to it are blocked either way.
More: [dynamic connections](constraints.md#dynamic-connections-built-per-session).

<!-- /site:accordion -->

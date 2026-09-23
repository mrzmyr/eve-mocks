# FAQ

Start with [Mocks](mocks.md). These are the cases the basics do not cover.

<!-- site:accordion -->

### Do I have to mock a connection's sign-in?

No. eve-mocks answers it, and the connection's own auth code receives
`mock-token`. Why, and when to write `oauthToken`:
[Authentication](authentication.md).

### Which requests pass without a mock or an allow entry?

| Request | Why |
| --- | --- |
| loopback (`localhost`, `127.0.0.1`, `[::1]`) | eve's processes talk to each other over it |
| `data:`, `blob:`, `file:` | no network involved |
| `api.vercel.com`, `telemetry.vercel.com`, only under a wrapped `eve dev` | eve's own credential gate and telemetry, shown as `eve-dev` in the summary |

These are checked last. A mock or an [allow](allow.md) entry for the same URL
wins, and a connection's [sign-in](authentication.md) still gets `mock-token`.

### Why does eve dev reach api.vercel.com under --mocks?

The TUI's credential gate and CLI telemetry live on `api.vercel.com` and
`telemetry.vercel.com`, eve's own hosts. Under a wrapped `eve dev` they pass by
default, shown as `eve-dev` in the run summary. A mock or an
[allow](allow.md) entry for the same URL wins, and a connection sign-in still
gets `mock-token`.

### My token endpoint sends no `grant_type`. Why is it blocked?

Only a request with `grant_type` is recognised as a sign-in. Name the endpoint
with [`oauthToken`](authentication.md#oauth).

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

### A connection downloads its OpenAPI spec at run time. Do I mock that request?

No. When the URL is the same one the mock's `spec` names, the connection gets
the pulled copy in `mocks/schemas/`. That request needs no mock of its own.

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

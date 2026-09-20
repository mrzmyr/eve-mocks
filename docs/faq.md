# FAQ

Start with [Mocks](mocks.md). These are the cases the basics do not cover.

<!-- site:accordion -->

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

### An upstream has no OpenAPI document. Can I still mock it?

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
and they count as `blocked`. Call the upstream with `fetch` to mock it.

### `list` shows a dynamic connection without a URL. What now?

Its module builds the URL inside the `session.started` handler, so there is
nothing to read before a session. `add` cannot scaffold it; write
`mocks/<connection-name>.ts` by hand. The file name must equal the connection
name, because that is how it is matched. Calls to it are blocked either way.
More: [dynamic connections](constraints.md#dynamic-connections-built-per-session).

<!-- /site:accordion -->

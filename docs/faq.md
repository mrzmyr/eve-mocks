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

### Where do pulled schema files go?

Into `mocks/schemas/`, named after the mock file: `mocks/notion.ts` reads
`notion.openapi.json`, and `mocks/linear.ts` reads `linear.tools.json`. A URL
inside a `spec` array is numbered by its position, such as
`shop.2.openapi.json` for the second entry.

### Why is a tool missing from the mocked server?

The mock lists exactly the tools that have a result. Add a result for the tool
and it appears. eve filters tools by the connection's allow-list anyway, so a
tool without a result is one the model could not call.

### `list` shows a dynamic connection without a URL. What now?

Its module builds the URL inside the `session.started` handler, so there is
nothing to read before a session. `add` cannot scaffold it; write
`mocks/<connection-name>.ts` by hand. The file name must equal the connection
name, because that is how it is matched. Calls to it are blocked either way.
More: [dynamic connections](how-it-works.md#dynamic-connections).

### My client uses axios, got, or a gRPC SDK. Is it mocked?

It is blocked, not mocked. eve-mocks answers `fetch` only. Requests through
`node:http`, `node:https`, and `node:http2` throw unless their URL is allowed,
and they count as `blocked`. Call the upstream with `fetch` to mock it.

### Is code that runs in the eve sandbox mocked?

No. The sandbox is another machine or a container, which the preload does not
reach. What it may call is decided by the sandbox's own network policy.

### Can I run `pull` in CI?

You should not need to. `pull` runs on your machine, and the schemas are
committed. CI reads them from the repository and needs neither the upstreams
nor their credentials. See [Run in CI](guides/ci.md).

### Does it work with npm, pnpm, or yarn?

Yes. Only the flag differs: `npm run eval -- --mocks` needs the `--`, `bun run
eval --mocks` does not. The CLI always runs on Node, because its shebang asks
for it; the command it wraps may run on Node or Bun.

### Can one run use a different set of mocks?

Yes, point `--dir` at another folder: `eve-mocks --dir mocks/outage -- eve eval
--mocks`. Mocks are per run, not per eval.

### Is it on npm?

Not yet. Until then, link it from a clone with `bun link`. See
[constraints](how-it-works.md#constraints).

<!-- /site:accordion -->

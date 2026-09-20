# Defining mocks

Reference for the files in `mocks/`. For the workflow, see the [README](../README.md).

## Mock files

One file per upstream at the top level of `mocks/`. Each default-exports a
mock, an allow entry, or an array of them. The file name is the mock's name in
`list` and in the call summary. Subfolders are ignored, so schemas and
fixtures can live next to the mocks.

**MCP server**, from its pulled `tools/list` plus one result per tool:

```ts
// mocks/tracker.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://tracker.example.com/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Stale numbers" }),
    list_teams: () => ({ teams: [TEAM] }),
  },
});
```

The schema file carries the real tool names, descriptions, and input schemas.
The model reads them, so a paraphrased description makes an eval test a
different prompt than production.

The mock lists exactly the tools that have a result. A hosted server's real
`tools/list` can hold dozens of tools, mutations included; a read-only
connection that allows 20 of them gets a mock with 20 results, which lists 20
tools. eve filters tools by the connection's
allow-list anyway, so a tool without a result is one the model could not call.

**REST upstream**, from pinned routes, its pulled OpenAPI document (3.0
or 3.1), or both:

```ts
// mocks/notion.ts
import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "https://api.notion.com/",
  spec: "https://developers.notion.com/openapi.json",
  routes: {
    "/v1/search": {
      POST: async ({ request }) => {
        const { query } = (await request.json()) as { query: string };

        return { results: PAGES.filter((page) => page.title.includes(query)), has_more: false };
      },
    },
    "/v1/pages/{page_id}": {
      GET: ({ params }) => ({ ...PAGE, id: params.page_id }),
      PATCH: () => new Response(null, { status: 403 }),
    },
  },
});
```

- **Routes** are path, then method. Paths use the spec's `{param}` syntax, so
  they copy from the spec; methods are upper-case, as in `Request.method`. A
  handler receives `{ request, params }` and returns a `Response`, or any JSON
  value sent as 200.
- **Without a route**, the spec answers with the operation's lowest 2xx
  response: the media `example` when there is one, else a sample generated from
  the response schema. Generated samples are smoke-test data (`"string"`, arrays of
  one); pin anything an eval asserts on.
- **Neither** answers 404, so a call the real API would reject does not pass
  silently.
- **Without `spec`**, only the routes answer.

`spec` names the upstream's OpenAPI JSON, in one of three ways:

```ts
// A URL: `eve-mocks pull` downloads it into mocks/schemas/.
defineHttpMock({ url: "https://api.notion.com/", spec: "https://developers.notion.com/openapi.json" });

// A local path, relative to mocks/: read in place, nothing to pull.
defineHttpMock({ url: "https://billing.example.com", spec: "../openapi/billing.json" });

// An array: several connections on one host, each with its own spec.
defineHttpMock({
  url: "https://api.shop.example.com",
  spec: ["../openapi/shop-orders.json", "../openapi/shop-catalog.json"],
});
```

- **Local path.** eve takes an OpenAPI connection's `spec` as a URL or as an
  inline object. Keep an inline one in a `.json` file, import it in the
  connection (`import spec from "./billing.json" with { type: "json" }`), and
  point the mock at the same file: the two cannot drift, and eve-mocks never
  runs app code to get it. In an eve extension, put the file next to `lib/`,
  not inside it: `eve extension build` accepts only modules there.
- **Array.** The documents' operations are merged; each keeps its own
  `components`, so a `$ref` resolves in the document that wrote it. Two
  documents declaring the same method and path stop the run, naming both.

A mock file never spells the path of a pulled schema. The file name decides it:
`mocks/notion.ts` reads `mocks/schemas/notion.openapi.json`, and
`mocks/tracker.ts` reads `mocks/schemas/tracker.tools.json`. A URL inside a
`spec` array is numbered by its position: `mocks/schemas/shop.2.openapi.json`
for the second entry. Commit the
schemas: evals then run offline and without credentials, and a changed tool
description shows up as a diff instead of as an eval that fails on one machine.

## Token endpoints and allowed upstreams

**Token endpoints**, so each connection's real `getToken` still runs:

```ts
// mocks/auth.ts
import { oauthToken, vercelConnect } from "eve-mocks";

const AUTH = [vercelConnect(), oauthToken({ url: "https://auth.example.com/oauth/token" })];

export default AUTH;
```

`vercelConnect()` also sets an unsigned, unexpired `VERCEL_OIDC_TOKEN` where
none is set: `@vercel/connect` reads it before it calls the token endpoint.

**Real upstreams that must stay reachable**, such as the model gateway:

```ts
// mocks/allowed.ts
import { allow } from "eve-mocks";

const ALLOWED = [allow({ url: "https://ai-gateway.vercel.sh/" })];

export default ALLOWED;
```

## Checks before a run

Before the wrapped command starts, and on `list`, every mock is checked against
its schema file. A mismatch stops the run with the nearest valid name:

```
eve-mocks: Route POST /v1/serach matches no operation of https://api.notion.com/
  fix: Did you mean POST /v1/search? Paths use the spec's {param} syntax and methods are upper-case

eve-mocks: Result "get_isue" names no tool of https://tracker.example.com/mcp
  fix: Did you mean get_issue? Else refresh the schema file with eve-mocks pull tracker
```

A schema file that was never pulled stops the run too:

```
eve-mocks: No schema for notion at mocks/schemas/notion.openapi.json
  why: The mock answers from the OpenAPI document of https://developers.notion.com/openapi.json, and it has not been pulled
  fix: Run: eve-mocks pull notion
```

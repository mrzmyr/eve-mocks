# Mocks

One file per upstream in `mocks/`. Each default-exports a mock, and its file
name is the mock's name in `list` and in the run summary.

```sh
bunx eve-mocks add linear     # writes mocks/linear.ts from the eve connection
bunx eve-mocks pull linear    # saves the upstream's schema to mocks/schemas/
```

## MCP

Give every tool your evals use a result. The function receives the call's
arguments and returns the JSON the tool answers with.

```ts
// mocks/linear.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://mcp.linear.app/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Checkout fails on retry" }),
    list_teams: () => ({ teams: [{ id: "team_1", name: "Platform" }] }),
  },
});
```

- **The mock lists only the tools that have a result.** A read-only agent never
  sees `create_issue` unless you add it.
- **Names, descriptions, and input schemas come from the pulled schema**, so the
  model reads the same text as in production.

## HTTP

Point `spec` at the upstream's OpenAPI document and pin the routes your evals
assert on. The spec answers everything else.

```ts
// mocks/notion.ts
import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "https://api.notion.com/",
  spec: "https://developers.notion.com/openapi.json",
  routes: {
    "/v1/pages/{page_id}": {
      GET: ({ params }) => ({ id: params.page_id, object: "page" }),
      PATCH: () => new Response(null, { status: 403 }),
    },
  },
});
```

| A request that matches | Gets |
| --- | --- |
| a route | what the handler returns: a `Response`, or any JSON value sent as 200 |
| only the spec | the operation's example, else a sample generated from its schema |
| neither | 404, as the real API would |

Routes are path, then upper-case method. Paths use the spec's `{param}` syntax,
so they copy straight from it. Generated samples are smoke-test data
(`"string"`, arrays of one), so pin anything an eval asserts on.

## Schemas

`pull` saves what the real upstream says about itself. You never spell the
path; the mock's file name decides it:

<!-- site:filetree -->
- mocks/
  - schemas/
    - linear.tools.json
    - notion.openapi.json
  - linear.ts
  - notion.ts
<!-- /site:filetree -->

```sh
bunx eve-mocks pull           # every mock with a remote schema
bunx eve-mocks pull notion    # one mock
```

Commit `mocks/schemas/`. Evals then run offline, and a changed tool description
arrives as a diff.

### Protected upstreams

`pull` is the one command that calls a real upstream, so it is the one that may
need a credential. It runs on your machine, never in CI.

| The upstream | Do this |
| --- | --- |
| MCP server with OAuth | Nothing. The first pull opens the browser, later pulls reuse the token. |
| needs a static token | `bunx eve-mocks pull events --header "Authorization: Bearer $TOKEN"` |
| token should stay out of the command line | give the mock `headers`, below |

```ts
defineHttpMock({
  url: "https://events.example.com/",
  spec: "https://events.example.com/openapi.json",
  headers: async () => ({ "x-api-key": process.env.EVENTS_API_KEY ?? "" }),
});
```

`headers` is sent by `pull` only, never to a mocked request. `--header` needs
the mock's name, so a token goes to one upstream and never to all of them.

## Checks

Every mock is checked against its schema before the agent starts, so a typo
stops the run with the nearest valid name:

```
eve-mocks: Result "get_isue" names no tool of https://mcp.linear.app/mcp
  fix: Did you mean get_issue? Else refresh the schema file with eve-mocks pull linear
```

```
eve-mocks: Route POST /v1/serach matches no operation of https://api.notion.com/
  fix: Did you mean POST /v1/search? Paths use the spec's {param} syntax and methods are upper-case
```

Local spec files, several specs on one host, and more: [FAQ](faq.md).

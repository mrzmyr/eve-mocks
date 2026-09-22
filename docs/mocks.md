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

Point `spec` at the upstream's OpenAPI spec and pin the routes your evals
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

A connection that downloads the same `spec` URL at run time gets the pulled copy,
so that request needs no mock of its own.

Routes are path, then upper-case method. Paths use the spec's `{param}` syntax,
so they copy straight from it. Generated samples are smoke-test data
(`"string"`, arrays of one), so pin anything an eval asserts on.

## Schemas

`pull` saves what the real upstream says about itself. You never spell the
path; the mock's file name decides it:

<!-- site:filetree -->
- mocks/
  - schemas/
    - linear.json
    - notion.json
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
| needs a token or an API key | pass it with `--header` |

```sh
bunx eve-mocks pull events --header "Authorization: Bearer $TOKEN"
```

`--header` is repeatable and needs the mock's name, so a credential goes to one
upstream and never to all of them. It is not stored anywhere.

Local spec files, several specs on one host, and more: [FAQ](faq.md).

One eval needs its own answer? Pin it in the eval: [Mocks per eval](evals.md).

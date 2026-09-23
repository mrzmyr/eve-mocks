# Mocks

One file per upstream in `mocks/`. Each default-exports a mock, and its file
name is the mock's name in `list` and in the run summary.

An answer lives in one of three places:

- Every eval can share it: `results` or `routes` in that file.
- One assertion depends on it: [`mock`](evals.md) inside the eval.
- It has to be the real upstream: [`allow`](allow.md).

An MCP mock lists the tools you gave a result. An HTTP mock answers every
operation in the spec; pin a route for anything an assertion depends on.
Generated samples are smoke-test data (`"string"`, arrays of one).

```sh
bunx eve-mocks add linear     # writes mocks/linear.ts, pulls an MCP server's tools/list to mocks/schemas/
bunx eve-mocks pull linear    # refreshes the schema, or pulls an HTTP mock's spec
```

## MCP

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

Each result receives the call's arguments and returns the JSON the tool answers
with.

The function: [`defineMcpMock`](api/define-mcp-mock.md).

## HTTP

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

A pinned route wins. Otherwise the request gets the operation's example, or a
sample generated from its schema, or 404.

The function: [`defineHttpMock`](api/define-http-mock.md).

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

`--header` is not stored. The flag's rules: [CLI](cli.md).

Local spec files, several specs on one host, and more: [FAQ](faq.md).

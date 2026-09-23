# defineHttpMock

Mock an HTTP API from pinned routes, its OpenAPI documents (3.0 or 3.1), or both. Import it from `eve-mocks` and default-export it from `mocks/<name>.ts`.

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

## Parameters

| Name | |
| --- | --- |
| `url` | Production URL prefix the paths hang off. |
| `spec` | The upstream's OpenAPI JSON: a URL, a path relative to `mocks/`, or an array of them. Optional. |
| `routes` | Pinned answers, path then upper-case method. Optional. |

A handler returns a `Response`, or any JSON value sent as 200. Paths use the spec's `{param}` syntax, so they copy straight from it. With a `spec`, every route must name an operation it declares.

| A request that matches | Gets |
| --- | --- |
| a route | what the handler returns |
| only the spec | the operation's example, else a sample generated from its schema |
| neither | 404 |

Generated samples are smoke-test data (`"string"`, arrays of one), so pin anything an eval asserts on. Leave `spec` out and only the routes answer.

A URL in `spec` is downloaded by `eve-mocks pull` into `mocks/schemas/`. An array merges the documents' operations; two documents that declare the same method and path stop the run. A local path is read in place and never pulled.

The file name is the mock's name in `list` and in the run summary. How the file fits the run: [Mocks](../mocks.md). Several specs on one host, and sharing a spec file with the connection: [FAQ](../faq.md).

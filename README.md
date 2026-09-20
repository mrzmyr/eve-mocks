# eve-mocks

In-process stand-ins for the upstreams an [eve](https://eve.dev/docs) agent
reads, so it runs without credentials and without touching production data.

- **No servers, no ports.** Mocks answer inside the agent's own processes.
- **No mock branches.** Connections keep their production URLs and their real
  token code; only `fetch` changes.
- **Deny by default.** Under `--mocks`, a request that is neither mocked nor
  allowed throws, so nothing reaches production by accident.

## Use

Route the app's scripts through the wrapper once:

```json
{
  "scripts": {
    "eval": "eve-mocks -- eve eval",
    "mocks": "eve-mocks"
  }
}
```

```sh
npm run eval                 # untouched: real APIs
npm run eval -- --mocks      # upstreams answered by the mocks
npm run mocks list           # every connection and mock, with its status
```

`eve-mocks init` creates the `mocks/` folder and wraps the `dev` and `eval`
scripts. A script that chains commands (`&&`, `;`, `|`) is skipped: the shell
splits it before the wrapper runs, so wrap the command that starts eve by hand.

`--mocks` sits in the wrapped command, not before `--`, because a package
manager appends script arguments at the end. The wrapper removes it before the
command sees it.

## Defining a mock

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
  // Pulled tools the mock does not list, such as mutations a read-only connection never allows.
  omit: ["create_issue"],
  pull: {
    headers: async () => ({ authorization: `Bearer ${process.env.TRACKER_TOKEN}` }),
  },
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Stale numbers" }),
  },
});
```

The schema file carries the real tool names, descriptions, and input schemas. The model
reads them, so a paraphrased description makes an eval test a different prompt
than production.

**REST upstream**, from pinned routes, its pulled OpenAPI document (3.0
or 3.1), or both:

```ts
// mocks/notion.ts
import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "https://api.notion.com/",
  source: "https://developers.notion.com/openapi.json",
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
- **Without `source` and without a schema file**, only the routes answer.

A mock file never spells a schema path. The file name decides it:
`mocks/notion.ts` reads `mocks/schemas/notion.openapi.json`, and
`mocks/tracker.ts` reads `mocks/schemas/tracker.tools.json`. Commit the
schemas: evals then run offline and without credentials, and a changed tool
description shows up as a diff instead of as an eval that fails on one machine.

## Checks before a run

Before the wrapped command starts, and on `list`, every mock is checked against
its schema file. A mismatch stops the run with the nearest valid name:

```
eve-mocks: Route POST /v1/serach matches no operation of https://api.notion.com/
  fix: Did you mean POST /v1/search? Paths use the spec's {param} syntax and methods are upper-case

eve-mocks: No result for tool "list_initiatives" of https://tracker.example.com/mcp
  fix: Add results.list_initiatives, or leave the tool out with omit: ["list_initiatives"]
```

So a refreshed schema file with a new tool fails the next run until someone
writes its result. A schema file that was never pulled stops the run too:

```
eve-mocks: No schema for notion at mocks/schemas/notion.openapi.json
  why: The mock answers from the OpenAPI document of https://developers.notion.com/openapi.json, and it has not been pulled
  fix: Run: eve-mocks pull notion
```

## Schema files: `pull` and `add`

```sh
eve-mocks pull            # refresh every schema file that names a source
eve-mocks pull notion     # one mock
eve-mocks add catalog     # scaffold mocks/catalog.ts from eve's manifest
```

`pull` downloads a REST mock's `source`, and the real `tools/list` of an MCP
mock's `url`, into `mocks/schemas/`. One failing upstream does not stop the others.
`pull.headers` authenticates the request and must be self-contained: read the
environment, do not import app code. A server behind user OAuth needs a
signed-in user's bearer token.

`add` knows a static connection's protocol and URL from the manifest. A dynamic
connection has neither there; write its mock by hand.

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

## What happens to a request under `--mocks`

| Request | Result |
| --- | --- |
| URL starts with a mock's `url` | answered in-process |
| URL starts with an `allow` entry | sent to the real upstream |
| loopback (`localhost`, `127.0.0.1`, `[::1]`) | passes: eve's processes talk over it |
| `data:`, `blob:`, `file:` | passes: no network involved |
| anything else | throws, with the `allow(...)` line to paste |

The run ends with a summary; the `blocked` line is the to-do list:

```
eve-mocks: mocked: auth 2, notion 6, tracker 10
eve-mocks: allowed: ai-gateway.vercel.sh 14
eve-mocks: blocked: logs.example.com 1
```

## `list`

```
catalog       NOT_SUPPORTED   https://catalog.example.com/api
logs     UNKNOWN_URL     dynamic connection, URL unknown before a session starts
tracker          SUPPORTED       https://tracker.example.com/mcp
auth            SUPPORTED       https://api.vercel.com/v1/connect/token/ (not an eve connection)
```

Connections come from eve's compiled manifest
(`.eve/compile/compiled-agent-manifest.json`). eve documents that file's path
but not its fields, so its shape is checked on every read and an unknown shape
fails with an error instead of a wrong list. Without a manifest, `list` prints
the mocks and how to get one (`eve info`). A run does not need the manifest.

A dynamic connection (`defineDynamic`) has no URL in the manifest; it is
matched to a mock by name, and shows `UNKNOWN_URL` without one. It is still
guarded: deny by default does not need to know the URL.

## How it works

The wrapper starts the command with `NODE_OPTIONS=--import=<preload>` and
`BUN_OPTIONS=--preload=<preload>`. Both are inherited, so the preload runs in
every process the command spawns, which is how eve runs connections. The
preload loads `mocks/`, patches global `fetch`, and appends one line per call
to a log the wrapper summarises at exit. Without `--mocks` the command runs
untouched: no environment, no preload.

## Constraints

- **Only `fetch` is patched.** A client built on `node:http`, such as the
  LaunchDarkly server SDK, is neither mocked nor blocked. eve's MCP and OpenAPI
  connections all use `fetch`.
- **MCP mocks are stateless.** eve's MCP client calls tools without an
  `mcp-session-id` header, as the hosted servers allow. A session-checking
  server answers `Missing mcp-session-id header` (HTTP 400). See the
  [transport spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management).
- **Every top-level file in `mocks/` is imported**, by the CLI and by the
  preload. Keep scripts and tests in a subfolder, or they run on every load.
- **Relative imports in mock files need the `.ts` extension.** Node loads them
  by type stripping, which does not resolve extensionless imports. See the
  [Node docs](https://nodejs.org/api/typescript.html#type-stripping). For the
  same reason a mock file cannot import app code that uses extensionless
  imports.
- **Not published yet.** Node refuses to strip types under `node_modules`, so
  the package needs a JavaScript build before it can ship to npm. Inside this
  workspace the symlink resolves to the source, which works.

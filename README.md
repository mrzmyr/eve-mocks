# eve-mocks

Run an [eve](https://eve.dev/docs) agent and its evals with no credentials and
no calls to production. Mocks answer inside the agent's own processes: no
servers, no ports, no mock branches in connection code.

Under `--mocks` every request is mocked, explicitly allowed, or throws.

## Your first mock

Mock one upstream end to end. The same six steps repeat for the next one.

### 1. Install

```sh
bun add -d eve-mocks
bunx eve-mocks init
```

`init` creates `mocks/` and sends the `dev` and `eval` scripts through the
wrapper:

```json
"eval": "eve-mocks -- eve eval"
```

Without `--mocks` that script still runs untouched, against the real APIs.

Until the package is on npm, link it from a clone instead: see
[constraints](docs/how-it-works.md#constraints).

### 2. See what the agent calls

```sh
bunx eve info          # compiles the app, so eve-mocks can read its connections
bun run mocks list
```

```
eve connections
  notion                  ✗ blocked   https://api.notion.com/
  tracker                 ✗ blocked   https://tracker.example.com/mcp
```

Every connection starts `blocked`: under `--mocks` a call to it throws. Pick one
and mock it.

### 3. Scaffold the mock

```sh
bun run mocks add tracker
```

Writes `mocks/tracker.ts` with that connection's production URL and protocol,
read from eve's own manifest.

### 4. Save the upstream's schema

```sh
bun run mocks pull tracker
```

Downloads the server's tool list (MCP) or OpenAPI document (REST) into
`mocks/schemas/`. Run this once on your machine and commit the result: evals
then run offline, and CI never needs the upstream or its credentials.

### 5. Pin what your eval asserts on

An MCP server needs one result per tool:

```ts
// mocks/tracker.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://tracker.example.com/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Checkout fails on retry" }),
  },
});
```

A REST upstream answers from its spec, plus the routes you pin:

```ts
// mocks/notion.ts
import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "https://api.notion.com/",
  spec: "https://developers.notion.com/openapi.json",
  routes: {
    "/v1/pages/{page_id}": { GET: ({ params }) => ({ ...PAGE, id: params.page_id }) },
  },
});
```

Every name is checked against the schema before the agent starts, so a typo
stops the run with `Did you mean get_issue?` instead of a strange answer
mid-eval.

### 6. Run it

```sh
bun run eval --mocks
```

```
eve-mocks: mocked: tracker 10
eve-mocks: blocked: api.notion.com 6
```

`mocked` was answered in-process. `blocked` is the to-do list: repeat steps 3
to 5 for each host, or let it through when the eval needs the real thing, such
as the model:

```ts
// mocks/allowed.ts
import { allow } from "eve-mocks";

export default [allow({ url: "https://ai-gateway.vercel.sh/" })];
```

The thrown error carries the `allow(...)` line to paste. A run that made a
blocked call exits 1, even when every eval passed.

A green run says so, and the last step is to commit `mocks/` with
`mocks/schemas/`:

```
eve-mocks: mocked: auth 2, notion 6, tracker 10
eve-mocks: allowed: ai-gateway.vercel.sh 14
eve-mocks: report: .eve-mocks/report.json
```

## Where to go next

- **[Defining mocks](docs/defining-mocks.md)** — MCP and REST mocks in full: spec forms, routes, token endpoints, allowed upstreams, and the checks before a run.
- **[Schema files](docs/schemas.md)** — `pull` and `add` in detail, plus auth for a protected upstream and OAuth-protected MCP servers.
- **[Run in CI](docs/ci.md)** — the workflow, which secrets you still need, the coverage gate, and the run report.
- **[CLI](docs/cli.md)** — every command, `--json`, exit codes, and what coding agents can rely on.
- **[How it works](docs/how-it-works.md)** — the preload, what happens to each request, dynamic connections, and the known limits.
- **[Example app](example)** — a tiny app with mocks, run under both Node and Bun.

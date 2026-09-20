# eve-mocks

Run an [eve](https://eve.dev/docs) agent and its evals with no credentials and
no calls to production. Mocks answer inside the agent's own processes: no
servers, no ports, no mock branches in connection code.

Under `--mocks` every request is mocked, explicitly allowed, or throws.

<!-- site:prompt Let your **coding agent** set up the first mock. -->
**Prompt for your coding agent**

```text
Set up eve-mocks in this eve app and mock its first upstream.

1. Run `bunx eve-mocks --help` and read it. It documents every command, JSON shape, and exit code.
2. Run `bunx eve-mocks init`, then `bunx eve info`, then `bunx eve-mocks list --json`.
3. Pick one connection with status "blocked" that the evals use. Run `bunx eve-mocks add NAME` and `bunx eve-mocks pull NAME`. If pull needs a sign-in or a token, stop and ask me.
4. In mocks/NAME.ts, pin only what the evals assert on: one result per MCP tool, or routes for a HTTP upstream.
5. Run the evals with --mocks until the summary has no blocked line. Never allow() an upstream without asking me; the model gateway is the usual exception.
6. Show me the final summary and the files you created.

Docs for agents: https://eve-mocks.vercel.app/llms.txt
```
<!-- /site:prompt -->

## Your first mock

Mock one upstream end to end. The same six steps repeat for the next one.

<!-- site:steps -->

### 1. Install

```sh
bun add -d eve-mocks
bunx eve-mocks init
```

`init` creates `mocks/` and sends the `dev` and `eval` scripts through the
wrapper. Without `--mocks` those scripts still run untouched, against the real
APIs.

<!-- site:filetree -->
- mocks/
  - vercel-connect.ts
- package.json
<!-- /site:filetree -->

```json
"eval": "eve-mocks -- eve eval",
"mocks": "eve-mocks"
```

Until the package is on npm, link it from a clone instead: see
[constraints](docs/how-it-works.md#constraints).

### 2. List Mocks

```sh
bunx eve info          # compiles the app, so eve-mocks can read its connections
bun run mocks list
```

```
eve connections
  linear                  ✗ blocked   MCP   https://mcp.linear.app/mcp
  notion                  ✗ blocked   HTTP  https://api.notion.com/
```

Every connection starts `blocked`: under `--mocks` a call to it throws. Pick one.

### 3. Add Mock

```sh
bun run mocks add linear
```

Writes the mock with that connection's production URL and type, read from
eve's own manifest.

<!-- site:filetree -->
- mocks/
  - linear.ts
  - vercel-connect.ts
<!-- /site:filetree -->

### 4. Pull Schema

```sh
bun run mocks pull linear
```

Saves the server's real tool list (MCP) or OpenAPI document (HTTP). Run it once
on your machine and commit the file: evals then run offline, and CI never needs
the upstream or its credentials.

<!-- site:filetree -->
- mocks/
  - schemas/
    - linear.tools.json
  - linear.ts
  - vercel-connect.ts
<!-- /site:filetree -->

### 5. Pin Results

An MCP server needs one result per tool your evals use:

```ts
// mocks/linear.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://mcp.linear.app/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Checkout fails on retry" }),
  },
});
```

An HTTP upstream answers from its spec, plus the routes you pin:

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

### 6. Run Evals

```sh
bun run eval --mocks
```

```
eve-mocks
  ✓ mocked    linear 10
  ✗ blocked   api.notion.com 6
  report      .eve-mocks/report.json
```

`mocked` was answered in-process. `blocked` is the to-do list, and it fails the
run with exit 1 even when every eval passed. Repeat steps 3 to 5 for each host,
or let it through when the eval needs the real thing, such as the model:

```ts
// mocks/allowed.ts
import { allow } from "eve-mocks";

export default [allow({ url: "https://ai-gateway.vercel.sh/" })];
```

A green run has no `blocked` row. Commit `mocks/` with `mocks/schemas/`:

```
eve-mocks
  ✓ mocked    auth 2, notion 6, linear 10
  → allowed   ai-gateway.vercel.sh 14
  report      .eve-mocks/report.json
```

<!-- /site:steps -->

## Next Steps

- **[Defining mocks](docs/defining-mocks.md)**: MCP and HTTP mocks in full: spec forms, routes, token endpoints, allowed upstreams, and the checks before a run.
- **[Schema files](docs/schemas.md)**: `pull` and `add` in detail, plus auth for a protected upstream and OAuth-protected MCP servers.
- **[Run in CI](docs/ci.md)**: the workflow, which secrets you still need, the coverage gate, and the run report.
- **[CLI](docs/cli.md)**: every command, `--json`, exit codes, and what coding agents can rely on.
- **[How it works](docs/how-it-works.md)**: the preload, what happens to each request, dynamic connections, and the known limits.
- **[Example app](example)**: a tiny app with mocks, run under both Node and Bun.

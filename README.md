# eve-mocks

```sh
bun run dev --mocks    # or: bun run eval --mocks
```

Mocks for [eve](https://eve.dev/docs) agents.

Run an eve agent and its evals with no credentials and
no calls to production. Mocks answer inside the agent's own processes: no
servers, no ports, no mock branches in connection code.

Under `--mocks` every request is mocked, explicitly allowed, or throws.

[![A security eval for a roadmap agent: Linear mocked, Notion allowed](https://raw.githubusercontent.com/mrzmyr/eve-mocks/main/demo/demo.gif)](https://github.com/mrzmyr/eve-mocks/raw/main/demo/demo.mp4)

Watch the [demo with voice-over](https://github.com/mrzmyr/eve-mocks/raw/main/demo/demo.mp4), 96 seconds.

<!-- site:prompt Let your **coding agent** set up the first mock. -->
**Prompt for your coding agent**

```text
Set up eve-mocks in this eve app and mock its first upstream.

1. Run `bunx eve-mocks --help` and read it. It documents every command, JSON shape, and exit code.
2. Run `bunx eve-mocks init`, then `bunx eve info`, then `bunx eve-mocks list --json`.
3. Pick one connection with status "block" that the evals use. Run `bunx eve-mocks add NAME` and `bunx eve-mocks pull NAME`. If pull needs a sign-in or a token, stop and ask me.
4. In mocks/NAME.ts, pin only what the evals assert on: one result per MCP tool, or routes for an HTTP upstream.
5. Run the evals with --mocks until the summary has no block line. Never allow() an upstream without asking me; the model gateway is the usual exception.
6. Show me the final summary and the files you created.

Docs for agents: https://eve-mocks.vercel.app/llms.txt
```
<!-- /site:prompt -->

## Your first mock

Mock one upstream end to end. The same six steps repeat for the next one.

<!-- site:steps -->

### 1. bunx eve-mocks init

Creates `mocks/` and routes the `dev` and `eval` scripts through the wrapper
(install first: `bun add -d eve-mocks`). Without `--mocks` they run untouched,
against the real APIs.

```json
"eval": "eve-mocks -- eve eval"
```

### 2. bunx eve-mocks list

```
eve connections
  linear                  ✗ block     MCP   https://mcp.linear.app/mcp
  notion                  ✗ block     HTTP  https://api.notion.com/
```

Every connection starts `block`: under `--mocks` a call to it throws. Pick
one. If the list is empty, run `bunx eve info` once to compile the app.

### 3. bunx eve-mocks add linear

Writes `mocks/linear.ts` with that connection's production URL and type, read
from eve's own manifest.

### 4. bunx eve-mocks pull linear

Saves the server's real tool list (MCP) or OpenAPI spec (HTTP) to
`mocks/schemas/linear.json`. Run it once on your machine and commit the file:
evals then run offline, and CI never needs the upstream or its credentials.

### 5. Create Mock

Give every tool your evals use a result:

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

Every name is checked against the schema before the agent starts, so a typo
stops the run with `Did you mean get_issue?` instead of a strange answer
mid-eval. [HTTP APIs are mocked from their OpenAPI spec](docs/mocks.md#http).

### 6. Run Evals

```sh
bun run eval --mocks
```

This run read an issue from Linear and a page from Notion:

```
❅ eve-mocks  5 calls, 2 block

  ✓ mock                3
  └─ linear             3
     └─ get_issue       3

  ✗ block               2
  └─ api.notion.com     2   connection "notion"

  report      .eve-mocks/report.json
```

Linear was answered in-process. Notion was a block, and a block fails
the run with exit 1. Mock it too by repeating steps 3 to 5, or
[allow](docs/allow.md) it when the eval needs the real thing:

```ts
// mocks/notion.ts
import { allow } from "eve-mocks";

export default allow({ url: "https://api.notion.com/" });
```

A green run has no `block` row. Commit `mocks/`:

```
❅ eve-mocks  5 calls, no block

  ✓ mock             3
  └─ linear          3
     └─ get_issue    3

  → allow            2
  └─ notion          2

  report      .eve-mocks/report.json
```

<!-- /site:steps -->

## Next Steps

- **[Mocks](docs/mocks.md)**: MCP and HTTP mocks, schemas, and protected upstreams.
- **[Allow](docs/allow.md)**: let a real upstream through, and what a block does.
- **[CLI](docs/cli.md)**: every command, `--json`, and exit codes.
- **[FAQ](docs/faq.md)**: sign-ins, several specs on one host, local spec files, and clients that do not use `fetch`.
- **[Run in CI](docs/ci.md)**: the workflow, secrets, the coverage gate, and the run report.
- **[Constraints](docs/constraints.md)**: what is not mocked, and why.
- **[Example app](example)**: a tiny app with mocks, run under Node and Bun.

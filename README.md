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

```json
"eval": "eve-mocks -- eve eval",
"mocks": "eve-mocks"
```

Until the package is on npm, link it from a clone instead: see
[Constraints](docs/constraints.md#not-published-yet).

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
<!-- /site:filetree -->

### 5. Pin Results

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

This eval reads an issue from Linear and a page from Notion:

```ts
// evals/roadmap.eval.ts
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Reads an issue from Linear and the roadmap page from Notion.",
  async test(t) {
    await t.send("What is blocking LIN-42, and is it on the Notion roadmap page?");
    t.succeeded();
    t.check(t.reply, includes("Checkout fails on retry"));
  },
});
```

```sh
bun run eval --mocks
```

```
eve-mocks  6 calls, 3 blocked

  ✓ mocked    linear                   3   get_issue 3
  ✗ blocked   ai-gateway.vercel.sh     1
              api.notion.com           2   connection "notion"

  report      .eve-mocks/report.json
```

Linear was answered in-process. Everything else was blocked, and a blocked call
fails the run with exit 1. Each blocked row is a to-do:

- **Notion** is another upstream to mock: repeat steps 3 to 5.
- **The model** has to stay real, so [allow](docs/allow.md) it:

```ts
// mocks/ai-gateway.ts
import { allow } from "eve-mocks";

export default allow({ url: "https://ai-gateway.vercel.sh/" });
```

A green run has no `blocked` row. Commit `mocks/`:

```
eve-mocks  25 calls, none blocked

  ✓ mocked    linear          3   get_issue 3
              notion          8
  → allowed   ai-gateway     14

  report      .eve-mocks/report.json
```

<!-- /site:steps -->

## Next Steps

- **[Mocks](docs/mocks.md)**: MCP and HTTP mocks, schemas, and the checks before a run.
- **[Authentication](docs/authentication.md)**: mock token endpoints, and pull from a protected upstream.
- **[Allow](docs/allow.md)**: let a real upstream through, and what a blocked call does.
- **[CLI](docs/cli.md)**: every command, `--json`, and exit codes.
- **[FAQ](docs/faq.md)**: several specs on one host, local spec files, dynamic connections, and more.
- **[Run in CI](docs/ci.md)**: the workflow, secrets, the coverage gate, and the run report.
- **[Constraints](docs/constraints.md)**: what is not mocked, and why.
- **[Example app](example)**: a tiny app with mocks, run under Node and Bun.

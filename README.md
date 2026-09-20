# eve-mocks

Run an [eve](https://eve.dev/docs) agent and its evals without credentials and
without touching production. Upstreams are answered inside the agent's own
processes: no servers, no ports, no mock branches in connection code. Under
`--mocks`, a request that is neither mocked nor allowed throws.

```sh
npm run eval -- --mocks
```

```
eve-mocks: mocked: auth 2, notion 6, tracker 10
eve-mocks: allowed: ai-gateway.vercel.sh 14
eve-mocks: blocked: logs.example.com 1
```

## Set up, once

```sh
npx eve-mocks init     # creates mocks/, wraps the dev and eval scripts in package.json
npx eve info           # compiles the app, so eve-mocks can read its connections
npx eve-mocks list     # what is mocked, allowed, and blocked
```

`init` turns `"eval": "eve eval"` into `"eval": "eve-mocks -- eve eval"`.
Without `--mocks` that script runs untouched, against the real APIs. A script
that chains commands (`&&`, `;`, `|`) is skipped; wrap the command that starts
eve by hand. Add `"mocks": "eve-mocks"` to the scripts for the commands below.

## Mock a connection

```sh
npm run mocks list             # 1. pick a row that says blocked
npm run mocks add tracker       # 2. writes mocks/tracker.ts with its URL and protocol
npm run mocks pull tracker      # 3. saves the real tool list or OpenAPI spec to mocks/schemas/
```

4\. Fill in what your evals assert on. An MCP server needs one result per tool:

```ts
// mocks/tracker.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://tracker.example.com/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Stale numbers" }),
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

5\. Commit `mocks/` with `mocks/schemas/`. Evals then run offline, and a changed
tool description shows up as a diff.

A typo in a route or tool name stops the run before the agent starts, with the
nearest valid name. More: [defining mocks](docs/defining-mocks.md) (spec forms,
token endpoints, checks) and [schema files](docs/schemas.md) (auth for `pull`,
OAuth-protected MCP servers).

## A run says `blocked`

A blocked call throws inside the agent and fails the run with exit 1. The
`blocked:` line of the summary is the to-do list. For each host, either:

- **mock it**: [Mock a connection](#mock-a-connection), or
- **let it through**, when the eval needs the real thing, such as the model:

```ts
// mocks/allowed.ts
import { allow } from "eve-mocks";

export default [allow({ url: "https://ai-gateway.vercel.sh/" })];
```

The thrown error carries the `allow(...)` line to paste. What passes without
either: [request rules](docs/how-it-works.md#what-happens-to-a-request-under---mocks).

## Run in CI

```yaml
- run: npm ci
- run: npm run eval -- --mocks
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }} # the one allowed upstream
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: eve-mocks-report, path: .eve-mocks/report.json }
```

- **Schemas are committed, not pulled.** `pull` runs on your machine; CI reads
  `mocks/schemas/` and needs neither the upstreams nor their credentials.
- **A blocked call fails the run**, even when every eval passed: a model that
  recovers from the thrown error would otherwise hide that the agent reached
  for an upstream nobody decided on. Opt out with `--no-fail-on-blocked`.
- **Secrets**: only those of the upstreams in `allowed.ts`. Token endpoints are
  mocked; see [token endpoints](docs/defining-mocks.md#token-endpoints-and-allowed-upstreams).
- **Report**: `.eve-mocks/report.json` holds the latest run: calls per upstream
  and per MCP tool. The folder ignores itself in git. Shape: `eve-mocks --help`.

To also fail when a connection has no mock yet, before any eval runs:

```yaml
- run: npx eve info
- run: npx eve-mocks list --json | jq -e '[.[] | select(.isConnection and .status == "blocked")] | length == 0'
```

## Something is off

```sh
npx eve-mocks info     # versions, paths, counts, and each problem with its fix
```

Every error prints `why` and `fix`. Known limits, such as sandbox traffic and
clients that do not use `fetch`: [constraints](docs/how-it-works.md#constraints).

## For coding agents

```sh
eve-mocks --help             # every command, option, JSON shape, and exit code
eve-mocks <command> --help
eve-mocks list --json        # with --json, an error is JSON on stderr too
```

The help needs no README. stdout holds the result only; hints and errors go to
stderr.

## Reference

- [Defining mocks](docs/defining-mocks.md): MCP and REST mocks, spec forms, token endpoints, allowed upstreams, checks
- [Schema files](docs/schemas.md): `pull`, `add`, auth for protected upstreams
- [How it works](docs/how-it-works.md): request rules, `list`, dynamic connections, constraints
- [Example app](example)

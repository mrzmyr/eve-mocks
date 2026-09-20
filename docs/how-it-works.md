# How it works

Reference. For the workflow, see the [README](../README.md).

The wrapper starts the command with `NODE_OPTIONS=--import=<preload>` and
`BUN_OPTIONS=--preload=<preload>`. Both are inherited, so the preload runs in
every process the command spawns, which is how eve runs connections. The
preload loads `mocks/`, patches global `fetch`, guards Node's HTTP modules, and appends one line per call
to a log under `.eve-mocks/runs/`. At exit the wrapper summarises that log on
stderr and in `.eve-mocks/report.json`, and turns a blocked call into exit 1
unless the run carries `--no-fail-on-blocked`. Without `--mocks` the command runs
untouched: no environment, no preload.

## What happens to a request under `--mocks`

| Request | Result |
| --- | --- |
| URL starts with a mock's `url` | answered in-process |
| URL starts with an `allow` entry | sent to the real upstream |
| loopback (`localhost`, `127.0.0.1`, `[::1]`) | passes: eve's processes talk over it |
| `data:`, `blob:`, `file:` | passes: no network involved |
| anything else | throws, with the `allow(...)` line to paste |
| any request through `node:http`, `node:https`, `node:http2` | passes when loopback or allowed, else throws; never answered by a mock |

The run ends with a summary; the `blocked` line is the to-do list:

```
eve-mocks: mocked: auth 2, notion 6, tracker 10
eve-mocks: allowed: ai-gateway.vercel.sh 14
eve-mocks: blocked: logs.example.com 1
```

## `list`

```
eve connections
  catalog               ✗ blocked   https://catalog.example.com/api
  logs             ✗ blocked   https://logs.example.com/mcp (dynamic)
  tracker                  ✓ mocked    https://tracker.example.com/mcp
  reports                → allowed   https://reports.example.com
  tenant-api              ✗ blocked   dynamic connection, its module constructs no URL before a session starts

other upstreams
  ai-gateway.vercel.sh    → allowed   https://ai-gateway.vercel.sh/
  auth                    ✓ mocked    https://api.vercel.com/v1/connect/token/

under --mocks: ✓ mocked: a mock answers · → allowed: reaches the real upstream · ✗ blocked: the call throws
```

Each row says what a call does under `--mocks`, in the words the run summary
uses: `mocked` (a mock answers), `allowed` (an `allow()` entry lets it reach
the real upstream), `blocked` (the call throws). A mock wins over an allow
entry. The second section holds the mocks and allow entries that match no eve
connection, such as a token endpoint or the model gateway. Colours follow
`NO_COLOR` and are dropped when the output is not a terminal.

`--json` prints the same rows as one JSON array on stdout, for scripts and CI:

```bash
# Fail when an eve connection has no mock.
eve-mocks list --json | jq -e '[.[] | select(.isConnection and .status == "blocked")] | length == 0'
```

```json
{ "name": "logs", "status": "blocked", "url": "https://logs.example.com/mcp", "isConnection": true, "isDynamic": true }
```

`url` is absent for a dynamic connection whose URL could not be read.

Connections come from eve's compiled manifest
(`.eve/compile/compiled-agent-manifest.json`). eve documents that file's path
but not its fields, so its shape is checked on every read and an unknown shape
fails with an error instead of a wrong list. Without a manifest, `list` prints
the mocks and how to get one (`eve info`). A run does not need the manifest.

## Dynamic connections

A dynamic connection (`defineDynamic`) has no URL in the manifest, only the
path of its module. `list` and `add` import that module with eve's connection
constructors (`defineMcpClientConnection`, `defineOpenAPIConnection`) wrapped,
and read the URL the module passes in. The `session.started` handler never
runs, so whatever it checks (a role, a flag, a tenant) does not matter,
and no config is needed.

```ts
// URL read at import: shown in `list`, matched to a mock by URL.
const connection = defineMcpClientConnection({ url: "https://logs.example.com/mcp" });
export default defineDynamic({ events: { "session.started": (_event, ctx) => (isAllowed(ctx) ? connection : null) } });

// URL built per session: nothing to read. Shown without a URL, matched by mock file name.
export default defineDynamic({
  events: { "session.started": (_event, ctx) => defineMcpClientConnection({ url: getTenantUrl(ctx) }) },
});
```

Both are guarded either way: deny by default does not need to know the URL.
Importing a connection module runs its top-level code, as eve's compile does.
A module that fails to import is named on stderr and is shown without a URL. This
needs Node 22.15 or newer
([`module.registerHooks`](https://nodejs.org/api/module.html#moduleregisterhooksoptions)),
which the CLI's shebang gives it under every package manager. Forced onto Bun
(`bun --bun eve-mocks list`), `list` and `add` stop with that requirement rather
than print a list without URLs. A run under `--mocks` works on both runtimes.

## Constraints

- **Only `fetch` is mocked; `node:http`, `node:https`, and `node:http2` are
  blocked.** A client built on them, such as axios, got, or a gRPC-based Google
  Cloud SDK, throws unless its URL is allowed, and counts as `blocked`. It
  cannot be answered by a mock: call the upstream with `fetch` for that. eve's
  MCP and OpenAPI connections all use `fetch`. Raw `node:net` and `node:tls`
  sockets and the `undici` package used directly are neither mocked nor blocked.
- **Sandbox traffic is neither mocked nor blocked.** Code the agent runs in an
  eve [sandbox](https://eve.dev/docs/sandbox) executes on another machine or in
  a container, which the preload does not reach. What it may call is decided by
  the sandbox's own network policy.
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
  the package needs a JavaScript build before it can ship to npm. Until then,
  link it (`bun link`, `npm link`): the symlink resolves to the source, which works.
- **The wrapped command may run on Node or Bun.** The wrapper sets
  `NODE_OPTIONS` and `BUN_OPTIONS`, so the mocks reach either. The CLI itself
  runs on Node.

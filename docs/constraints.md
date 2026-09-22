# Constraints

eve-mocks works by loading a preload into every process the wrapped command
spawns. The preload patches global `fetch` and guards Node's HTTP modules. Each
limit below follows from that.

## Only `fetch` is mocked

`node:http`, `node:https`, and `node:http2` are blocked, not mocked. A client
built on them, such as axios, got, or a gRPC-based SDK, throws unless its URL is
allowed, and counts as `block`. Call the upstream with `fetch` to mock it.
eve's own connections all use `fetch`.

Raw `node:net` and `node:tls` sockets and the `undici` package used directly
are neither mocked nor blocked.

## Sandbox traffic is out of reach

Code the agent runs in an eve [sandbox](https://eve.dev/docs/sandbox) executes
on another machine or in a container, which the preload does not reach. It is
neither mocked nor blocked. What it may call is decided by the sandbox's own
network policy.

## `mock(t, …)` reads eve internals

eve gives an eval no identity, so `mock(t, …)` wraps `t.send` and `t.session`
to learn which sessions belong to it, and reads the session of a call from
eve's context store, `Symbol.for("eve.context-storage")`. If a future eve
renames that store, pinned answers stop applying and the mock file answers
instead. See [Mocks per eval](evals.md).

## MCP mocks are stateless

eve's MCP client calls tools without an `mcp-session-id` header, as the hosted
servers allow. A client that checks sessions gets `Missing mcp-session-id
header` (HTTP 400). See the
[transport spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management).

## Every top-level file in `mocks/` is imported

By the CLI and by the preload, on every load. Keep scripts, fixtures, and tests
in a subfolder; subfolders are ignored.

## Relative imports need the `.ts` extension

Node loads mock files by
[type stripping](https://nodejs.org/api/typescript.html#type-stripping), which
does not resolve extensionless imports. For the same reason a mock file cannot
import app code that uses them.

## Dynamic connections built per session

`list` and `add` read a dynamic connection's URL by importing its module with
eve's connection constructors wrapped. The `session.started` handler never runs,
so an audience, flag, or tenant check does not matter.

```ts
// URL read at import: shown in `list`, matched to a mock by URL.
const connection = defineMcpClientConnection({ url: "https://logs.example.com/mcp" });
export default defineDynamic({ events: { "session.started": (_event, ctx) => (isAllowed(ctx) ? connection : null) } });

// URL built per session: nothing to read. Shown without a URL, matched by mock file name.
export default defineDynamic({
  events: { "session.started": (_event, ctx) => defineMcpClientConnection({ url: getTenantUrl(ctx) }) },
});
```

Both are blocked until mocked or allowed; deny by default does not need the URL.
Reading the URL needs Node 22.15 or newer, which the CLI's shebang provides
under every package manager.

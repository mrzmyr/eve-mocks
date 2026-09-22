# Allow

Under `--mocks` a call has one outcome: mock, allow, or block. `allow()` lets one
upstream through to the real thing, for the few an eval cannot do without, such
as the model.

```ts
// mocks/ai-gateway.ts
import { allow } from "eve-mocks";

// Evals need a real model.
export default allow({ url: "https://ai-gateway.vercel.sh/" });
```

One file per allowed upstream, with a comment that says why. The file name is
its name in `list` and in the run summary, and `git grep "allow("` finds
everything that can reach production.

`url` is a prefix. Keep it as narrow as the eval allows: a path, not a host.

## Block

Everything else throws inside the agent, with the line to paste:

```
eve-mocks block GET https://logs.example.com/mcp
  why: Under --mocks a request must be mocked or allowed, and logs.example.com is neither
  fix: Mock it: eve-mocks add <connection>, or write mocks/<name>.ts
       Or allow it in mocks/<name>.ts: export default allow({ url: "https://logs.example.com/" })
```

The run summary collects them, names the eve connection a host belongs to, and
one block fails the run with exit 1, even when every eval passed. A
model that recovers from the thrown error would otherwise hide that the agent
reached for an upstream nobody decided on.

```
❅ eve-mocks  31 calls, 1 block

  ✓ mock                 16
  ├─ linear              10
  │  ├─ get_issue         6
  │  └─ list_teams        4
  └─ notion               6

  → allow                14
  └─ ai-gateway          14

  ✗ block                 1
  └─ logs.example.com     1   connection "logs"

  report      .eve-mocks/report.json

✗ eve-mocks  1 block failed the run

  fix  logs.example.com
         mock it   eve-mocks add logs
         allow it  mocks/logs.ts: export default allow({ url: "https://logs.example.com/" })
```

To let such a run pass anyway:

```sh
bun run eval --mocks --no-fail-on-block
```

## What passes without an entry

| Request | Why |
| --- | --- |
| loopback (`localhost`, `127.0.0.1`, `[::1]`) | eve's processes talk to each other over it |
| `data:`, `blob:`, `file:` | no network involved |
| `api.vercel.com`, `telemetry.vercel.com`, only under a wrapped `eve dev` | eve's own credential gate and telemetry, shown as `eve-dev` in the summary |

The eve dev default is checked last: a mock or an allow entry for the same URL
wins, and a connection's [sign-in](faq.md#do-i-have-to-mock-a-connections-sign-in)
still gets `mock-token`.

A mock wins over an allow entry for the same URL. Requests through `node:http`
are blocked but never mocked: see [Constraints](constraints.md#only-fetch-is-mocked).

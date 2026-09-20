# Allow

Under `--mocks` a request is mocked, allowed, or blocked. `allow()` lets one
upstream through to the real thing, for the few an eval cannot do without, such
as the model.

```ts
// mocks/model-gateway.ts
import { allow } from "eve-mocks";

// Evals need a real model.
export default allow({ url: "https://ai-gateway.vercel.sh/" });
```

One file per allowed upstream, with a comment that says why. The file name is
its name in `list` and in the run summary, and `git grep "allow("` finds
everything that can reach production. `init` creates this one for you.

`url` is a prefix. Keep it as narrow as the eval allows: a path, not a host.

## Blocked

Everything else throws inside the agent, with the line to paste:

```
logs.example.com is neither mocked nor allowed
  fix: Add a mock for it, or allow({ url: "https://logs.example.com/" }) in the mocks directory
```

The run summary collects them, and one blocked call fails the run with exit 1,
even when every eval passed. A model that recovers from the thrown error would
otherwise hide that the agent reached for an upstream nobody decided on.

```
eve-mocks
  ✓ mocked    linear 10, notion 6
  → allowed   model-gateway 14
  ✗ blocked   logs.example.com 1
```

To let such a run pass anyway:

```sh
bun run eval --mocks --no-fail-on-blocked
```

## What passes without an entry

| Request | Why |
| --- | --- |
| loopback (`localhost`, `127.0.0.1`, `[::1]`) | eve's processes talk to each other over it |
| `data:`, `blob:`, `file:` | no network involved |

A mock wins over an allow entry for the same URL. The full rules:
[How it works](how-it-works.md#what-happens-to-a-request-under---mocks).

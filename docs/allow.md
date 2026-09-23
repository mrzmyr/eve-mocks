# Allow

Under `--mocks` a call has one outcome: mock, allow, or block. `allow()` lets
one upstream through to the real thing. The call reaches production, CI needs
that upstream's secret, and the response is whatever production returns. Allow
the model gateway. Mock any upstream whose body an assertion depends on.

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
A mock for the same URL is the one that answers.

The function: [`allow`](api/allow.md).

## Block

Everything else throws inside the agent. The run summary collects the blocks,
names the eve connection a host belongs to, and one block fails the run with
exit 1, even when every eval passed. A model that recovers from the thrown
error would otherwise hide that the agent reached for an upstream nobody
decided on.

```
❅ eve-mocks  31 calls, 1 block

  ✓ mock                 16
  ├─ linear              10
  └─ notion               6

  → allow                14
  └─ ai-gateway          14

  ✗ block                 1
  └─ logs.example.com     1   connection "logs"

✗ eve-mocks  1 block failed the run

  fix  logs.example.com
         mock it   eve-mocks add logs
         allow it  mocks/logs.ts: export default allow({ url: "https://logs.example.com/" })
```

In CI the job fails the same way.
[`--no-fail-on-block`](ci.md#why-did-ci-fail-when-every-eval-passed) lets it pass.

## What passes without an entry

Loopback (`localhost`, `127.0.0.1`, `[::1]`), `data:`, `blob:`, and `file:`
pass without a file. Under a wrapped `eve dev`, so do `api.vercel.com` and
`telemetry.vercel.com`. The list:
[FAQ](faq.md#which-requests-pass-without-a-mock-or-an-allow-entry).

A connection's [sign-in](authentication.md) is already answered.

# Allow

Under `--mocks` each call has one outcome: mock, allow, or block. `allow()`
sends the calls to one upstream to the real service:

- The call goes to production.
- CI needs the secret of that upstream.
- The response comes from production.

Allow the model gateway. Mock each upstream whose response an assertion uses.

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

Each other call throws an error inside the agent.

- The run summary lists each blocked call.
- The run summary names the eve connection of each blocked host.
- One block fails the run with exit 1, also when all evals pass.

The exit code is necessary. A model can recover from the thrown error. Without
the exit code, nobody sees that the agent called an upstream that nobody
approved.

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

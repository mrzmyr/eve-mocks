# getState

Read the state one session left on a stateful mock. Import it from `eve-mocks/evals`.

```ts
import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import { getState } from "eve-mocks/evals";

type Linear = { issues: { id: string; title: string }[] };

export default defineEval({
  async test(t) {
    const turn = await t.send("File an issue: checkout returns 500");
    const { issues } = await getState<Linear>(turn, "linear");

    assert.ok(issues.some((issue) => issue.title.includes("checkout")));
  },
});
```

## Parameters

| Name | |
| --- | --- |
| `session` | A turn `t.send` returned, or a session `t.session` created. Anything with a `sessionId`. |
| `mock` | The mock's file name, as `list` shows it. |

## Returns

A promise of the state after the session's latest call to the mock. Before the first call it is what [`seed`](seed.md) set, else what the mock's `state()` returns. Pass the type as `getState<Linear>(…)`; without it the result is `unknown`.

It rejects when no mock file has this name, or when the mock declares no `state`. It works without `seed` or `mock` in the same eval.

How state works: [Mocks](../mocks.md#state).

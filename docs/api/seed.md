# seed

Set where this eval's sessions start on a stateful mock. Import it from `eve-mocks/evals`.

```ts
import { defineEval } from "eve/evals";
import { seed } from "eve-mocks/evals";

export default defineEval({
  async test(t) {
    seed(t, "linear", { issues: [] });

    await t.send("File an issue: checkout returns 500");

    t.calledTool("create_issue");
  },
});
```

## Parameters

| Name | |
| --- | --- |
| `t` | The eval's context. `send` and `session` are wrapped to learn which sessions belong to this eval. |
| `mock` | The mock's file name, as `list` shows it. |
| `state` | Initial state. Replaces what the mock's `state()` returns. Sent as JSON. |

Call it inside `test(t)`, before the session starts. It is synchronous. Each session this eval creates starts from its own copy. Sessions other evals create keep the mock file's `state`. A later `seed` for the same mock overrides an earlier one.

The next `t.send` or `t.session` fails when no mock file has this name, or when the mock declares no `state`. The call throws when the eval runs outside `eve-mocks --`.

Read the result back with [`getState`](get-state.md). How state works: [Mocks](../mocks.md#state).

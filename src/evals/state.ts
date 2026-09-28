import { resolveStateful } from "./resolve-operation.ts";
import { findScope, findState, getScope, type EvalContext } from "./scope.ts";
import { ensureServer } from "./server.ts";

/**
 * Replace the initial state of a stateful mock for the sessions this eval
 * creates. Each of them starts from its own copy of this value; other evals
 * keep the mock file's `state`.
 *
 * Synchronous, so an eval need not await it. Call it inside `test(t)` before
 * the session it is for starts. The next `t.send` or `t.session` fails when no
 * mock file has this name, or when it declares no `state`. A later `seed` for
 * the same mock overrides an earlier one.
 *
 * @param t - The eval's context. Its `send` and `session` are wrapped to learn
 *   which sessions belong to this eval.
 * @param mock - The mock's file name, as `list` shows it.
 * @param state - Initial state; crosses to the dev server as JSON.
 * @throws MockError when the eval runs outside `eve-mocks --`.
 */
export function seed(t: EvalContext, mock: string, state: unknown): void {
  const listening = ensureServer();
  const scope = getScope({ t });
  const ready = Promise.all([resolveStateful({ name: mock, call: "seed" }), listening]).then(() => {
    scope.seeds.set(mock, state);
  });

  // Awaited by the next t.session or t.send; this only keeps an eval that
  // never starts a session from reporting an unhandled rejection.
  ready.catch(() => {});
  scope.pending.push(ready);
}

/**
 * The state of a stateful mock as one session left it: after its latest call
 * to the mock, else what `seed(t, …)` set, else the mock file's `state`. Await
 * it after the turn to assert on what the agent changed.
 *
 * `State` is never inferred from where the result goes, so it stays `unknown`
 * unless named: `getState<{ items: string[] }>(turn, "tracker")`.
 *
 * @param session - A turn `t.send` returned, or a session `t.session` created.
 * @param mock - The mock's file name, as `list` shows it.
 * @throws MockError when no mock file has this name, or it declares no `state`.
 */
export async function getState<State = unknown>(
  session: { readonly sessionId: string },
  mock: string,
): Promise<NoInfer<State>> {
  const { sessionId } = session;
  const stateful = await resolveStateful({ name: mock, call: "getState" });
  const found = findState({ sessionId, mock });

  if (found.has) {
    return found.state as State;
  }

  const seeds = findScope({ sessionId })?.seeds;

  if (seeds !== undefined && seeds.has(mock)) {
    return structuredClone(seeds.get(mock)) as State;
  }

  return stateful.createState?.() as State;
}

/**
 * State of stateful mocks, kept in the process that answers the calls.
 *
 * One state per mock and eve session, so twenty copies of an eval running at
 * once do not see each other's writes. A call outside any session shares one
 * state per process.
 */

import { askSeed, getSessionId, sendState } from "./ask-evals.ts";

/** Key of calls outside any eve session. */
const NO_SESSION = "";

/** State per mock and session, created on first use. */
const states = new Map<string, Promise<unknown>>();

/**
 * The state the current call reads and changes: the eval's seed or the mock's
 * own initial state on the session's first call, the same object after.
 *
 * @returns The state, and `save`, which hands it to the eval runner after the
 *   call; a no-op outside an eval.
 */
export async function loadState({
  mock,
  create,
}: {
  readonly mock: string;
  readonly create: () => unknown;
}): Promise<{ readonly state: unknown; readonly save: () => Promise<void> }> {
  const sessionId = getSessionId() ?? NO_SESSION;
  const key = `${mock}\0${sessionId}`;
  let created = states.get(key);

  if (created === undefined) {
    created = askSeed({ mock }).then((reply) => {
      if (reply === undefined) {
        return create();
      }

      return reply.seed;
    });
    states.set(key, created);

    // A failed lookup is asked again on the next call instead of failing the session for good.
    created.catch(() => {
      states.delete(key);
    });
  }

  const state = await created;

  return {
    state,
    save: () => {
      return sendState({ mock, state });
    },
  };
}

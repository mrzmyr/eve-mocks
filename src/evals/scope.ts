/**
 * Which eval a session belongs to. An eval's handlers answer only the sessions
 * that eval created, so twenty copies of one eval running at once do not
 * answer each other's calls.
 *
 * eve gives an eval no identity and lists no sessions on `t`, so `t.send`
 * and `t.session` are wrapped on the object the first `mock(t, …)` sees, and
 * the ids they resolve to are recorded. `t.send` is replaced by `t.session()`
 * followed by `session.send()`, which eve documents as equivalent: the id must
 * be known before the turn starts, and `t.send` resolves only when it ends.
 * See https://eve.dev/docs/evals/targets
 */

import type { EvalCall } from "./protocol.ts";

/** What an eval mocks: the whole `t.send`/`t.session` surface eve-mocks needs, and nothing else. */
export type EvalContext = {
  /** Creates a session; resolves with its id. */
  session(options?: { readonly signal?: AbortSignal }): Promise<EvalSession>;
  /** Creates a session and sends its first message. */
  send(message: unknown, options?: { readonly signal?: AbortSignal }): Promise<unknown>;
};

/** The part of an eve eval session eve-mocks reads. */
export type EvalSession = {
  readonly sessionId: string;
  send(message: unknown, options?: unknown): Promise<unknown>;
};

/** What a handler receives: the call's arguments, or the request with its path params. */
export type HandlerInput =
  | Readonly<Record<string, unknown>>
  | { readonly request: Request; readonly params: Readonly<Record<string, string>> };

/** One `mock(t, …)` call. */
export type Handler = {
  /** The mock's file name; empty until the operation is resolved. */
  mock: string;
  /** Tool name, or `METHOD /template`; empty until the operation is resolved. */
  key: string;
  /** Answers a call, or returns `undefined` to pass. */
  readonly answer: (input: HandlerInput) => unknown;
  /** Where in the eval file the handler was registered, for errors. */
  readonly site: string;
};

/** Everything one eval registered, and the sessions it owns. */
type Scope = {
  readonly sessions: Set<string>;
  /** Latest first: a later `mock()` for the same key overrides an earlier one. */
  readonly handlers: Handler[];
  /**
   * Operation lookups still running. `mock()` is synchronous so an eval need
   * not await it; a session starts only once every lookup is done, and a
   * failed lookup fails that `t.send` or `t.session`.
   */
  readonly pending: Promise<void>[];
};

const scopes = new WeakMap<EvalContext, Scope>();
const bySession = new Map<string, Scope>();

/** The scope of `t`, wrapping its session methods on first use. */
export function getScope({ t }: { readonly t: EvalContext }): Scope {
  const existing = scopes.get(t);

  if (existing !== undefined) {
    return existing;
  }

  const scope: Scope = { sessions: new Set(), handlers: [], pending: [] };

  scopes.set(t, scope);

  const session = t.session.bind(t);

  t.session = async (options) => {
    await Promise.all(scope.pending);

    const created = await session(options);

    scope.sessions.add(created.sessionId);
    bySession.set(created.sessionId, scope);

    return created;
  };

  t.send = async (message, options) => {
    const created = await t.session(options?.signal === undefined ? {} : { signal: options.signal });

    return created.send(message, options);
  };

  return scope;
}

/**
 * Register a handler with the scope of `t` now, in call order, and fill in its
 * mock and key once `target` resolves.
 */
export function addHandler({
  t,
  target,
  answer,
  site,
}: {
  readonly t: EvalContext;
  readonly target: Promise<{ readonly mock: string; readonly key: string }>;
  readonly answer: Handler["answer"];
  readonly site: string;
}): void {
  const scope = getScope({ t });
  const handler: Handler = { mock: "", key: "", answer, site };

  scope.handlers.unshift(handler);

  const ready = target.then(({ mock, key }) => {
    handler.mock = mock;
    handler.key = key;
  });

  // Awaited by the next t.session or t.send; this only keeps an eval that
  // never starts a session from reporting an unhandled rejection.
  ready.catch(() => {});
  scope.pending.push(ready);
}

/** Handlers of the eval that owns `sessionId`, for one mock and key; none for a session no eval created. */
export function findHandlers({
  mock,
  key,
  sessionId,
}: {
  readonly mock: string;
  readonly key: string;
  readonly sessionId: string;
}): readonly Handler[] {
  const scope = bySession.get(sessionId);

  if (scope === undefined) {
    return [];
  }

  return scope.handlers.filter((handler) => {
    return handler.mock === mock && handler.key === key;
  });
}

/** Keys the eval that owns `sessionId` mocked on `mock`. */
export function findOperations({ mock, sessionId }: { readonly mock: string; readonly sessionId: string }): readonly string[] {
  const scope = bySession.get(sessionId);

  if (scope === undefined) {
    return [];
  }

  return [
    ...new Set(
      scope.handlers
        .filter((handler) => {
          return handler.mock === mock;
        })
        .map((handler) => {
          return handler.key;
        }),
    ),
  ];
}

/** The input a handler gets for a call. */
export function toInput({ call, request }: { readonly call: EvalCall; readonly request: Request | undefined }): HandlerInput {
  if (call.kind === "tool") {
    return call.args;
  }

  if (request === undefined) {
    throw new Error("A request call needs its Request");
  }

  return { request, params: call.params };
}

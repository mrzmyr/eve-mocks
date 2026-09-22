/**
 * The dev server's side of the wire: hand an intercepted call to the eval
 * that owns its session, over loopback, and answer with what its handler
 * returned.
 *
 * The session id comes from eve's own context store, a global
 * `AsyncLocalStorage` eve keeps under `Symbol.for("eve.context-storage")`
 * and fills for every step, including connection calls. Without a session,
 * or without the wrapper's port, nothing is asked and the mock file answers.
 */

import { createError } from "./errors.ts";
import { CALL_ROUTE, fromReply, OPERATIONS_ROUTE, PORT_ENV, type CallInput, type EvalCall, type EvalReply } from "./evals/protocol.ts";

/** Symbol eve stores its context `AsyncLocalStorage` under. */
const STORAGE = Symbol.for("eve.context-storage");

/** Context key eve files the current session id under. */
const SESSION_ID_KEY = { name: "eve.sessionId" };

/** Session id of the current eve step, or none outside one. */
function getSessionId(): string | undefined {
  const storage = (globalThis as Record<symbol, unknown>)[STORAGE] as
    | { readonly getStore?: () => { readonly get?: (key: { readonly name: string }) => unknown } | undefined }
    | undefined;
  const value = storage?.getStore?.()?.get?.(SESSION_ID_KEY);

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

/** Where the runner listens, or none when no eval can be asked. */
function getBase(): string | undefined {
  const port = process.env[PORT_ENV];

  if (port === undefined) {
    return undefined;
  }

  return `http://127.0.0.1:${port}`;
}

/**
 * The reply of the eval that owns the current session, or none: no eval
 * pinned this operation for it, or the call happens outside an eval.
 *
 * @throws MockError when the handler threw; the eval's stderr has the stack.
 */
export async function askEvals({
  mock,
  key,
  call,
}: {
  readonly mock: string;
  readonly key: string;
  readonly call: EvalCall;
}): Promise<Response | undefined> {
  const base = getBase();
  const sessionId = getSessionId();

  if (base === undefined || sessionId === undefined) {
    return undefined;
  }

  const input: CallInput = { mock, key, sessionId, call };
  const response = await fetch(`${base}${CALL_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (response.status === 204) {
    return undefined;
  }

  if (!response.ok) {
    const { site, message } = (await response.json()) as { readonly site?: string; readonly message: string };

    throw createError({
      status: 502,
      message: `mock(t, "${key}") failed`,
      why: message,
      fix: `Fix the handler at ${site ?? "the eval"}; the eval output has its stack`,
    });
  }

  return fromReply({ reply: (await response.json()) as EvalReply });
}

/** Operations the eval that owns the current session pinned on `mock`; none outside an eval. */
export async function listEvalOperations({ mock }: { readonly mock: string }): Promise<readonly string[]> {
  const base = getBase();
  const sessionId = getSessionId();

  if (base === undefined || sessionId === undefined) {
    return [];
  }

  const response = await fetch(`${base}${OPERATIONS_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mock, sessionId }),
  });
  const { operations } = (await response.json()) as { readonly operations: readonly string[] };

  return operations;
}

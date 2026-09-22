import { fileURLToPath } from "node:url";

import { resolveOperation } from "./resolve-operation.ts";
import { addHandler, type EvalContext, type HandlerInput } from "./scope.ts";
import { ensureServer } from "./server.ts";

/** A value `JSON.stringify` keeps as is. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** An HTTP operation: `METHOD /path`, optionally prefixed with the mock's name. A tool name has no space. */
export type HttpOperation = `${string} ${string}`;

/** What an HTTP handler receives. */
export type RouteInput = {
  /** The intercepted request, with its production URL. */
  readonly request: Request;
  /** Values of the path's `{param}` segments. */
  readonly params: Readonly<Record<string, string>>;
};

/** Answer of an MCP tool: fixed JSON, or a function of the call's arguments. `undefined` passes to the mock file. */
export type ToolAnswer = Json | ((args: Readonly<Record<string, unknown>>) => unknown);

/** Answer of an HTTP operation: fixed JSON or `Response`, or a function of the request. `undefined` passes to the mock file. */
export type RouteAnswer = Json | Response | ((input: RouteInput) => unknown);

/** This file, which the stack walk skips. */
const SELF = fileURLToPath(import.meta.url);

/** Where `mock()` was called, as the first stack frame outside this file. */
function getSite(): string {
  const line = new Error().stack
    ?.split("\n")
    .slice(1)
    .find((entry) => {
      return entry.includes("at ") && !entry.includes(SELF) && !entry.includes(import.meta.url);
    });

  if (line === undefined) {
    return "unknown";
  }

  return line.trim().slice("at ".length);
}

/**
 * Pin what one operation answers for the sessions this eval creates.
 *
 * Runs in the eval; the mock in the dev server forwards the call here. An
 * operation that no eval pinned is answered by the mock file, so `mock()` only
 * ever changes an answer. The tool of an MCP mock is listed to the eval's
 * sessions even when the mock file gives it no result.
 *
 * Synchronous, so an eval need not await it. Call it inside `test(t)` before
 * the session it is for starts. The operation is checked against the schema
 * files in the background, and the next `t.send` or `t.session` fails when it
 * matches no mock or more than one. Later calls for the same operation override
 * earlier ones. Sessions other evals create, and sessions eve creates on its
 * own, keep the mock file's answer.
 *
 * @param t - The eval's context. Its `send` and `session` are wrapped to learn
 *   which sessions belong to this eval.
 * @param operation - A tool name, `METHOD /path` in the spec's `{param}`
 *   syntax, or either prefixed with the mock's name: `linear:get_issue`.
 * @param answer - A fixed JSON value, or a function of the call.
 * @throws MockError when the eval runs outside `eve-mocks --`.
 */
export function mock(t: EvalContext, operation: HttpOperation, answer: RouteAnswer): void;
export function mock(t: EvalContext, operation: string, answer: ToolAnswer): void;
export function mock(t: EvalContext, operation: string, answer: ToolAnswer | RouteAnswer): void {
  const site = getSite();
  const listening = ensureServer();
  let handler = (input: HandlerInput): unknown => {
    void input;

    return answer;
  };

  if (typeof answer === "function") {
    handler = answer as (input: HandlerInput) => unknown;
  }

  addHandler({
    t,
    target: Promise.all([resolveOperation({ operation }), listening]).then(([resolved]) => {
      return resolved;
    }),
    answer: handler,
    site,
  });
}

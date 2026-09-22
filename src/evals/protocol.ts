/**
 * What crosses between the two processes of `eve eval`: the dev server, where
 * a mock intercepts a call, and the runner, where an eval's `mock()` handler
 * runs. Functions cannot cross, so a call and its reply are sent as JSON.
 */

/** Environment variable the wrapper sets: the loopback port the runner's eval mocks listen on. */
export const PORT_ENV = "EVE_MOCKS_EVALS_PORT";

/** Route the dev server posts an intercepted call to. */
export const CALL_ROUTE = "/call";

/** Route the dev server asks for the operations an eval mocked for a session. */
export const OPERATIONS_ROUTE = "/operations";

/** One intercepted call, as the dev server sends it. */
export type EvalCall =
  | {
      /** An MCP `tools/call`. */
      readonly kind: "tool";
      /** The call's arguments. */
      readonly args: Readonly<Record<string, unknown>>;
    }
  | {
      /** An HTTP request. */
      readonly kind: "request";
      readonly method: string;
      readonly url: string;
      readonly headers: readonly (readonly [string, string])[];
      /** Body as text; `null` for a request without one. */
      readonly body: string | null;
      /** Values of the matched path template's `{param}` segments. */
      readonly params: Readonly<Record<string, string>>;
    };

/** What the dev server posts to {@link CALL_ROUTE}. */
export type CallInput = {
  /** The mock's file name, as `list` shows it. */
  readonly mock: string;
  /** Tool name, or `METHOD /template` for an HTTP mock. */
  readonly key: string;
  /** eve session the call belongs to. */
  readonly sessionId: string;
  readonly call: EvalCall;
};

/** What the dev server posts to {@link OPERATIONS_ROUTE}. */
export type OperationsInput = {
  readonly mock: string;
  readonly sessionId: string;
};

/** A handler's return value, as the runner sends it back. */
export type EvalReply =
  | {
      /** Any JSON value; the mock sends it as 200. */
      readonly kind: "json";
      readonly value: unknown;
    }
  | {
      /** A `Response` the handler built, such as a 403. */
      readonly kind: "response";
      readonly status: number;
      readonly headers: readonly (readonly [string, string])[];
      readonly body: string;
    };

/** A `Headers` as pairs, which JSON carries. */
function toPairs({ headers }: { readonly headers: Headers }): (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];

  headers.forEach((value, key) => {
    pairs.push([key, value]);
  });

  return pairs;
}

/** Pairs as the `HeadersInit` a `Request` or `Response` takes. */
function fromPairs({ pairs }: { readonly pairs: readonly (readonly [string, string])[] }): [string, string][] {
  return pairs.map(([key, value]) => {
    return [key, value];
  });
}

/** A `Response` or a JSON value as an {@link EvalReply}. */
export async function toReply({ result }: { readonly result: unknown }): Promise<EvalReply> {
  if (result instanceof Response) {
    return {
      kind: "response",
      status: result.status,
      headers: toPairs({ headers: result.headers }),
      body: await result.text(),
    };
  }

  return { kind: "json", value: result };
}

/** An {@link EvalReply} as the `Response` the mock answers with. */
export function fromReply({ reply }: { readonly reply: EvalReply }): Response {
  if (reply.kind === "response") {
    return new Response(reply.body, { status: reply.status, headers: fromPairs({ pairs: reply.headers }) });
  }

  return Response.json(reply.value);
}

/** A `Request` as an {@link EvalCall}, with the path params the mock matched. */
export async function toCall({
  request,
  params,
}: {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
}): Promise<EvalCall> {
  let body: string | null = null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.clone().text();
  }

  return {
    kind: "request",
    method: request.method,
    url: request.url,
    headers: toPairs({ headers: request.headers }),
    body,
    params,
  };
}

/** The `Request` an HTTP handler receives, rebuilt from an {@link EvalCall}. */
export function fromCall({ call }: { readonly call: Extract<EvalCall, { kind: "request" }> }): Request {
  return new Request(call.url, {
    method: call.method,
    headers: fromPairs({ pairs: call.headers }),
    body: call.body,
  });
}

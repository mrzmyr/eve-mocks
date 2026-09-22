/**
 * The runner's side of the wire: a loopback HTTP server the dev server's
 * mocks post intercepted calls to. Handlers run here, in the process that
 * holds the eval's closures, and their result goes back as JSON.
 *
 * Started once, on the first `mock()`, on the port the wrapper chose. Loopback
 * passes the preload's guard in both processes, so nothing here is mocked or
 * blocked.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { createError } from "../errors.ts";
import { CALL_ROUTE, fromCall, OPERATIONS_ROUTE, PORT_ENV, toReply, type CallInput, type OperationsInput } from "./protocol.ts";
import { findHandlers, findOperations, toInput } from "./scope.ts";

let server: Server | undefined;
let listening: Promise<void> | undefined;

/** The whole body of a request as JSON. */
async function readBody({ request }: { readonly request: IncomingMessage }): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send({ response, status, body }: { readonly response: ServerResponse; readonly status: number; readonly body?: unknown }): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }

  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * Answer one intercepted call from the eval that owns its session. Handlers
 * are tried latest first; the first that returns something other than
 * `undefined` answers. 204 means none did, and the mock file answers.
 */
async function answerCall({ input, response }: { readonly input: CallInput; readonly response: ServerResponse }): Promise<void> {
  const handlers = findHandlers({ mock: input.mock, key: input.key, sessionId: input.sessionId });

  let request: Request | undefined;

  if (input.call.kind === "request") {
    request = fromCall({ call: input.call });
  }

  for (const handler of handlers) {
    let result: unknown;

    try {
      result = await handler.answer(toInput({ call: input.call, request: request?.clone() }));
    } catch (cause) {
      let why = String(cause);

      if (cause instanceof Error) {
        why = cause.message;
      }

      console.error(`eve-mocks: mock ${JSON.stringify(input.key)} at ${handler.site} threw: ${why}`);
      send({ response, status: 500, body: { site: handler.site, message: why } });
      return;
    }

    if (result !== undefined) {
      send({ response, status: 200, body: await toReply({ result }) });
      return;
    }
  }

  send({ response, status: 204 });
}

async function handle({ request, response }: { readonly request: IncomingMessage; readonly response: ServerResponse }): Promise<void> {
  if (request.method !== "POST") {
    send({ response, status: 405 });
    return;
  }

  const body = await readBody({ request });

  if (request.url === CALL_ROUTE) {
    await answerCall({ input: body as CallInput, response });
    return;
  }

  if (request.url === OPERATIONS_ROUTE) {
    const { mock, sessionId } = body as OperationsInput;

    send({ response, status: 200, body: { operations: findOperations({ mock, sessionId }) } });
    return;
  }

  send({ response, status: 404 });
}

/**
 * Start the server on the wrapper's port, once. Later calls wait for the same
 * start.
 *
 * @throws MockError when the wrapper did not set the port, which means the
 *   eval runs outside `eve-mocks --`.
 */
export function ensureServer(): Promise<void> {
  if (listening !== undefined) {
    return listening;
  }

  const port = Number(process.env[PORT_ENV]);

  if (!Number.isInteger(port) || port <= 0) {
    throw createError({
      status: 500,
      message: "mock() needs the eve-mocks wrapper",
      why: `${PORT_ENV} is not set, so the mocks in the dev server cannot reach this eval`,
      fix: "Run the evals through it: eve-mocks -- eve eval --mocks",
    });
  }

  server = createServer((request, response) => {
    handle({ request, response }).catch((cause: unknown) => {
      let message = String(cause);

      if (cause instanceof Error) {
        message = cause.message;
      }

      send({ response, status: 500, body: { message } });
    });
  });

  // The eval process must not stay alive for this server once the evals are done.
  server.unref();

  listening = new Promise<void>((resolve, reject) => {
    server?.once("error", (cause: NodeJS.ErrnoException) => {
      listening = undefined;

      if (cause.code === "EADDRINUSE") {
        reject(
          createError({
            status: 500,
            message: `Port ${port} is taken`,
            why: `Another process already listens on the port the wrapper chose for this run's eval mocks: only one process may call mock()`,
            fix: "Run the evals in one process, or start a new run",
            cause,
          }),
        );
        return;
      }

      reject(cause);
    });
    server?.listen(port, "127.0.0.1", resolve);
  });

  return listening;
}

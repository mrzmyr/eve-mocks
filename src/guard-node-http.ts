import { createRequire, syncBuiltinESMExports } from "node:module";

/**
 * The modules are loaded with `require`, not imported. Bun snapshots a
 * builtin's named exports at its first ESM import and cannot resync them, so
 * an import here would freeze `import { get } from "node:https"` to the
 * unguarded function before it is replaced. Node resyncs either way.
 */
const require = createRequire(import.meta.url);
const http: typeof import("node:http") = require("node:http");
const https: typeof import("node:https") = require("node:https");
const http2: typeof import("node:http2") = require("node:http2");

/** Node module a guarded call came through, as named in the thrown error. */
export type GuardedModule = "node:http" | "node:https" | "node:http2";

/**
 * Called for every request that is about to leave through a Node HTTP module.
 * Throw to stop it; return to let it through.
 */
export type Guard = (call: { readonly url: string; readonly method: string; readonly module: GuardedModule }) => void;

/** Whether `value` is a plain options object, not a URL or a callback. */
function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof URL);
}

/**
 * URL and method of a `request(url, options?, callback?)` or
 * `request(options, callback?)` call. With both, options override the URL's
 * parts, as in Node. See https://nodejs.org/api/http.html#httprequesturl-options-callback
 */
function readRequest({ scheme, args }: { readonly scheme: string; readonly args: readonly unknown[] }): {
  readonly url: string;
  readonly method: string;
} {
  const [first, second] = args;
  let base: URL | undefined;
  let options: Record<string, unknown> = {};

  if (typeof first === "string" || first instanceof URL) {
    base = new URL(first);

    if (isOptions(second)) {
      options = second;
    }
  } else if (isOptions(first)) {
    options = first;
  }

  // `host` may carry a port; `hostname` wins when both are set.
  const host = String(options.hostname ?? options.host ?? base?.hostname ?? "localhost");
  const protocol = String(options.protocol ?? base?.protocol ?? scheme);
  const port = options.port ?? base?.port ?? "";
  const path = String(options.path ?? `${base?.pathname ?? "/"}${base?.search ?? ""}`);
  let authority = host;

  if (port !== "" && !host.includes(":")) {
    authority = `${host}:${String(port)}`;
  }

  return { url: `${protocol}//${authority}${path}`, method: String(options.method ?? "GET").toUpperCase() };
}

/**
 * Put `guard` in front of every request made through `node:http`,
 * `node:https`, and `node:http2`.
 *
 * eve-mocks answers `fetch` only, so a client built on these modules, such as
 * axios, got, or a gRPC-based Google Cloud SDK, would reach production under
 * `--mocks` unseen. The guard keeps deny by default true for them. It can only
 * stop a request, not answer one: a mock needs `fetch`.
 *
 * Not covered: raw `node:net` and `node:tls` sockets, and the `undici` package
 * used directly. Node's own `fetch` does not pass through these modules.
 */
export function guardNodeHttp({ guard }: { readonly guard: Guard }): void {
  for (const [module, scheme, name] of [
    [http, "http:", "node:http"],
    [https, "https:", "node:https"],
  ] as const) {
    for (const method of ["request", "get"] as const) {
      const real = module[method];

      module[method] = function guarded(this: unknown, ...args: unknown[]) {
        guard({ ...readRequest({ scheme, args }), module: name });

        return Reflect.apply(real, this, args);
      } as typeof real;
    }
  }

  const connect = http2.connect;

  // An HTTP/2 session is opened per authority; its requests share that host.
  http2.connect = function guarded(this: unknown, ...args: unknown[]) {
    guard({ url: new URL(String(args[0])).href, method: "CONNECT", module: "node:http2" });

    return Reflect.apply(connect, this, args);
  } as typeof connect;

  // Without this, Node's `import { request } from "node:https"` keeps the unguarded function.
  // See https://nodejs.org/api/module.html#modulesyncbuiltinesmexports
  syncBuiltinESMExports();
}

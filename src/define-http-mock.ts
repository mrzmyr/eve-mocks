import { readFileSync, writeFileSync } from "node:fs";

import { sample } from "openapi-sampler";

import { createError, MockError } from "./errors.ts";
import { getClosest } from "./get-closest.ts";
import { resolvePath } from "./resolve-path.ts";
import type { Mock, PullOptions, Routes } from "./types.ts";

/** A JSON object node of an OpenAPI document. */
type Node = { readonly [key: string]: unknown };

/** HTTP methods an OpenAPI path item can declare, as `Request.method` spells them. */
const METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"];

/** Whether `value` is a JSON object, not an array or `null`. */
function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it is a JSON object, else an empty one. */
function getNode(value: unknown): Node {
  if (isNode(value)) {
    return value;
  }

  return {};
}

/**
 * Follow a local `$ref` such as `#/components/responses/Error`.
 *
 * Only response and media objects pass through here; schema `$ref`s are
 * resolved by openapi-sampler. See https://swagger.io/docs/specification/v3_0/using-ref/
 */
function resolveRef({ node, spec }: { readonly node: unknown; readonly spec: Node }): unknown {
  if (!isNode(node) || typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) {
    return node;
  }

  let target: unknown = spec;

  for (const key of node.$ref.slice(2).split("/")) {
    if (!isNode(target)) {
      return undefined;
    }

    // JSON Pointer escapes, see https://datatracker.ietf.org/doc/html/rfc6901#section-4
    target = target[key.replaceAll("~1", "/").replaceAll("~0", "~")];
  }

  return target;
}

/** Whether a template segment is a `{param}`. */
function isParam(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

/**
 * The path template a request path fills, with its `{param}` values.
 * `/users/me` beats `/users/{id}`: the template with the fewest parameters wins.
 */
function matchTemplate({
  templates,
  path,
}: {
  readonly templates: readonly string[];
  readonly path: string;
}): { readonly template: string; readonly params: Record<string, string> } | undefined {
  const segments = path.split("/");
  const countParams = (template: string) => {
    return template.split("/").filter(isParam).length;
  };
  const template = templates
    .filter((candidate) => {
      const parts = candidate.split("/");

      return (
        parts.length === segments.length &&
        parts.every((part, index) => {
          return part === segments[index] || isParam(part);
        })
      );
    })
    .sort((a, b) => {
      return countParams(a) - countParams(b);
    })[0];

  if (template === undefined) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (const [index, part] of template.split("/").entries()) {
    if (isParam(part)) {
      params[part.slice(1, -1)] = decodeURIComponent(segments[index] ?? "");
    }
  }

  return { template, params };
}

/** JSON error body in the shape the rest of eve-mocks reports errors. */
function respondError({
  status,
  message,
  why,
  fix,
}: {
  readonly status: number;
  readonly message: string;
  readonly why: string;
  readonly fix: string;
}): Response {
  return Response.json({ message, status, why, fix }, { status });
}

/** A handler's return value as a `Response`: passed through, or sent as JSON 200. */
function toResponse(result: unknown): Response {
  if (result instanceof Response) {
    return result;
  }

  return Response.json(result);
}

/**
 * Mock a REST upstream from pinned routes, its OpenAPI document (3.0 or 3.1),
 * or both.
 *
 * A request is answered by its route when one is pinned. Otherwise the spec
 * answers with the operation's lowest 2xx response: the media `example` when
 * there is one, else a sample generated from the schema. Generated samples are
 * smoke-test data; pin what an eval asserts on. A request that matches neither
 * answers 404, so a call the real API would reject does not pass silently.
 *
 * @param input.url - Production URL prefix the paths hang off.
 * @param input.spec - Snapshot of the OpenAPI JSON: a file URL, or a path
 *   relative to the mocks directory. Read on the first request, so processes
 *   that never call this upstream do not pay for it.
 * @param input.source - Where `eve-mocks pull` downloads `spec` from.
 * @param input.pull - How `eve-mocks pull` authenticates against `source`.
 * @param input.routes - Pinned answers, path then method. With a `spec`, every
 *   route must name an operation the spec declares; `check` enforces it.
 */
export function defineHttpMock({
  url,
  spec,
  source,
  pull,
  routes = {},
}: {
  readonly url: string;
  readonly spec?: string | URL;
  readonly source?: string;
  readonly pull?: PullOptions;
  readonly routes?: Routes;
}): Mock {
  let basePath = new URL(url).pathname;

  if (basePath.endsWith("/")) {
    basePath = basePath.slice(0, -1);
  }

  let document: Node | undefined;

  /** The parsed spec, or an empty document for a routes-only mock. */
  const loadSpec = (): Node => {
    if (spec === undefined) {
      return {};
    }

    document ??= JSON.parse(readFileSync(resolvePath({ path: spec }), "utf8")) as Node;

    return document;
  };

  return {
    url,
    handle: async (request) => {
      const loaded = loadSpec();
      const paths = getNode(loaded.paths);
      const path = new URL(request.url).pathname.slice(basePath.length);
      const match = matchTemplate({
        templates: [...new Set([...Object.keys(routes), ...Object.keys(paths)])],
        path,
      });

      if (match === undefined) {
        return respondError({
          status: 404,
          message: `No route or operation for ${request.method} ${path}`,
          why: "Neither the mock's routes nor its OpenAPI document declare this path",
          fix: "Check the request against the spec, pin a route, or refresh the spec with eve-mocks pull",
        });
      }

      const { template, params } = match;
      const handler = routes[template]?.[request.method];

      if (handler) {
        return toResponse(await handler({ request, params }));
      }

      const operation = getNode(paths[template])[request.method.toLowerCase()];

      if (!METHODS.includes(request.method) || !isNode(operation)) {
        return respondError({
          status: 404,
          message: `No route or operation for ${request.method} ${template}`,
          why: "The path exists, but neither the routes nor the OpenAPI document declare this method on it",
          fix: "Check the request against the spec, or pin the route",
        });
      }

      const responses = getNode(operation.responses);
      const code = Object.keys(responses)
        .filter((key) => {
          const status = Number(key);

          return Number.isInteger(status) && status >= 200 && status < 300;
        })
        .sort((a, b) => {
          return Number(a) - Number(b);
        })[0];

      if (code === undefined) {
        return respondError({
          status: 501,
          message: `No 2xx response for ${request.method} ${template}`,
          why: "The operation declares no success response to build a mock answer from",
          fix: `Pin routes["${template}"].${request.method}`,
        });
      }

      const response = resolveRef({ node: responses[code], spec: loaded });
      const media = resolveRef({
        node: getNode(getNode(response).content)["application/json"],
        spec: loaded,
      });

      if (!isNode(media)) {
        return new Response(null, { status: Number(code) });
      }

      if (media.example !== undefined) {
        return Response.json(media.example, { status: Number(code) });
      }

      return Response.json(sample(getNode(media.schema), { quiet: true }, loaded), {
        status: Number(code),
      });
    },
    check: async () => {
      if (spec === undefined) {
        return;
      }

      const paths = getNode(loadSpec().paths);

      for (const [template, handlers] of Object.entries(routes)) {
        for (const method of Object.keys(handlers)) {
          if (isNode(getNode(paths[template])[method.toLowerCase()]) && METHODS.includes(method)) {
            continue;
          }

          const operations = Object.entries(paths).flatMap(([candidate, item]) => {
            return METHODS.filter((entry) => {
              return isNode(getNode(item)[entry.toLowerCase()]);
            }).map((entry) => {
              return `${entry} ${candidate}`;
            });
          });
          const closest = getClosest({ value: `${method} ${template}`, candidates: operations });

          throw createError({
            status: 500,
            message: `Route ${method} ${template} matches no operation of ${url}`,
            why: "The mock has a spec, and the spec declares no such method and path, so the real API would reject this call",
            fix: `Did you mean ${closest}? Paths use the spec's {param} syntax and methods are upper-case`,
          });
        }
      }
    },
    pull: async () => {
      if (spec === undefined || source === undefined) {
        return undefined;
      }

      try {
        // `redirect: "error"`: a protected spec redirects to a login page, which
        // would otherwise be followed and fail later as unparseable JSON.
        const response = await fetch(source, {
          headers: (await pull?.headers?.()) ?? {},
          redirect: "error",
        });

        if (!response.ok) {
          throw createError({
            status: 502,
            message: `OpenAPI spec download failed for ${source}`,
            why: `The server answered ${response.status}`,
            fix: "Check the source URL and the credentials pull.headers reads",
          });
        }

        const path = resolvePath({ path: spec });
        writeFileSync(path, `${JSON.stringify(await response.json(), null, 2)}\n`);

        return path;
      } catch (cause) {
        if (cause instanceof MockError) {
          throw cause;
        }

        throw createError({
          status: 502,
          message: `OpenAPI spec download failed for ${source}`,
          why: "The server answered with a redirect, non-JSON body, or another fetch error",
          fix: "Check the source URL and the credentials pull.headers reads",
          cause,
        });
      }
    },
  };
}

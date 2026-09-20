import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { sample } from "openapi-sampler";

import { createError, MockError } from "./errors.ts";
import { readJson } from "./read-json.ts";
import { getClosest } from "./get-closest.ts";
import { getMocksDir } from "./get-mocks-dir.ts";
import { getSchemaPath } from "./get-schema-path.ts";
import type { Mock, MockContext, Routes } from "./types.ts";

/** A JSON object node of an OpenAPI document. */
type Node = { readonly [key: string]: unknown };

/** HTTP methods an OpenAPI path item can declare, as `Request.method` spells them. */
const METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"];

/** What to try when a spec download fails; most failures are missing auth. */
const AUTH_HINT =
  'Check the spec URL. If the spec is protected, pass its auth header: eve-mocks pull <name> --header "Name: value" (repeatable)';

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

/** One entry of a mock's `spec`, located. */
type SpecFile = {
  /** The entry as the mock file spells it: a URL or a local path. */
  readonly entry: string;
  /** File the document is read from: the pulled schema file, or the local spec itself. */
  readonly path: string;
  /** Whether `entry` is a URL, which `eve-mocks pull` downloads to `path`. */
  readonly isRemote: boolean;
};

/**
 * An operation with the document that declares it. Documents of a merged
 * `spec` keep their own `components`, so a `$ref` is resolved where it was written.
 */
type Operation = {
  /** The OpenAPI operation object. */
  readonly node: Node;
  /** The document `node` comes from. */
  readonly document: Node;
};

/** Operations of every document of a mock, path template then upper-case method. */
type Operations = Readonly<Record<string, Readonly<Record<string, Operation>>>>;

/** Whether a `spec` entry is a URL to pull, not a local path. */
function isRemote({ entry }: { readonly entry: string }): boolean {
  if (!URL.canParse(entry)) {
    return false;
  }

  const { protocol } = new URL(entry);

  return protocol === "https:" || protocol === "http:";
}

/**
 * Mock an HTTP API from pinned routes, its OpenAPI documents (3.0 or 3.1),
 * or both.
 *
 * A request is answered by its route when one is pinned. Otherwise the spec
 * answers with the operation's lowest 2xx response: the media `example` when
 * there is one, else a sample generated from the response schema. Generated samples are
 * smoke-test data; pin what an eval asserts on. A request that matches neither
 * answers 404, so a call the real API would reject does not pass silently.
 *
 * Documents are read on the first request, so processes that never call this
 * upstream do not pay for them. A mock without `spec` answers from its routes alone.
 *
 * @param input.url - Production URL prefix the paths hang off.
 * @param input.spec - The upstream's OpenAPI JSON: a URL, a local path, or an
 *   array of them. A URL is downloaded by `eve-mocks pull` into
 *   `schemas/<mock>.openapi.json`, or `schemas/<mock>.<position>.openapi.json`
 *   when `spec` is an array. A local path resolves against the mocks directory
 *   and is read in place, so the mock and the connection can share one file.
 *   An array merges the documents' operations, for several connections on one
 *   host; two documents declaring the same method and path stop the run.
 * @param input.routes - Pinned answers, path then method. With a `spec`,
 *   every route must name an operation it declares; `check` enforces it.
 */
export function defineHttpMock({
  url,
  spec,
  routes = {},
}: {
  readonly url: string;
  readonly spec?: string | readonly string[];
  readonly routes?: Routes;
}): Mock {
  let basePath = new URL(url).pathname;

  if (basePath.endsWith("/")) {
    basePath = basePath.slice(0, -1);
  }

  const locate = ({ name }: MockContext): SpecFile[] => {
    if (spec === undefined) {
      return [];
    }

    if (typeof spec === "string") {
      if (isRemote({ entry: spec })) {
        return [{ entry: spec, path: getSchemaPath({ name, kind: "openapi" }), isRemote: true }];
      }

      return [{ entry: spec, path: resolve(getMocksDir({ name }), spec), isRemote: false }];
    }

    return spec.map((entry, index) => {
      if (isRemote({ entry })) {
        return {
          entry,
          path: getSchemaPath({ name: `${name}.${index + 1}`, kind: "openapi" }),
          isRemote: true,
        };
      }

      return { entry, path: resolve(getMocksDir({ name }), entry), isRemote: false };
    });
  };

  let operations: Operations | undefined;

  /**
   * Operations of every `spec` document, or none for a routes-only mock.
   *
   * @throws MockError when a document is missing, or when two documents
   *   declare the same method and path.
   */
  const loadSpec = (context: MockContext): Operations => {
    if (operations !== undefined) {
      return operations;
    }

    const { name } = context;
    const merged: Record<string, Record<string, Operation>> = {};
    const owners: Record<string, string> = {};

    for (const file of locate(context)) {
      if (!existsSync(file.path)) {
        if (file.isRemote) {
          throw createError({
            status: 404,
            message: `No schema for ${name} at ${file.path}`,
            why: `The mock answers from the OpenAPI document of ${file.entry}, and it has not been pulled`,
            fix: `Run: eve-mocks pull ${name}`,
          });
        }

        throw createError({
          status: 404,
          message: `No spec for ${name} at ${file.path}`,
          why: `The mock names the local spec "${file.entry}", and no file is there`,
          fix: "Check the path; a local spec resolves against the mocks directory",
        });
      }

      const document = getNode(
        readJson({ path: file.path, fix: "Pull the spec again with eve-mocks pull, or fix the local spec file" }),
      );

      for (const [template, item] of Object.entries(getNode(document.paths))) {
        for (const method of METHODS) {
          const node = getNode(item)[method.toLowerCase()];

          if (!isNode(node)) {
            continue;
          }

          const key = `${method} ${template}`;

          if (owners[key] !== undefined) {
            throw createError({
              status: 500,
              message: `${key} is declared by two specs of ${name}`,
              why: `Both "${owners[key]}" and "${file.entry}" declare it, so the mock cannot tell which answer to give`,
              fix: "Remove the operation from one spec, or pin the route so neither spec answers it",
            });
          }

          owners[key] = file.entry;
          merged[template] = { ...merged[template], [method]: { node, document } };
        }
      }
    }

    operations = merged;

    return operations;
  };

  return {
    url,
    type: "http",
    handle: async (request, context) => {
      const loaded = loadSpec(context);
      const path = new URL(request.url).pathname.slice(basePath.length);
      const match = matchTemplate({
        templates: [...new Set([...Object.keys(routes), ...Object.keys(loaded)])],
        path,
      });

      if (match === undefined) {
        return respondError({
          status: 404,
          message: `No route or operation for ${request.method} ${path}`,
          why: "Neither the mock's routes nor its OpenAPI documents declare this path",
          fix: "Check the request against the spec, pin a route, or refresh a pulled spec with eve-mocks pull",
        });
      }

      const { template, params } = match;
      const handler = routes[template]?.[request.method];

      if (handler) {
        return toResponse(await handler({ request, params }));
      }

      const operation = loaded[template]?.[request.method];

      if (operation === undefined) {
        return respondError({
          status: 404,
          message: `No route or operation for ${request.method} ${template}`,
          why: "The path exists, but neither the routes nor the OpenAPI documents declare this method on it",
          fix: "Check the request against the spec, or pin the route",
        });
      }

      const { node, document } = operation;
      const responses = getNode(node.responses);
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

      const response = resolveRef({ node: responses[code], spec: document });
      const media = resolveRef({
        node: getNode(getNode(response).content)["application/json"],
        spec: document,
      });

      if (!isNode(media)) {
        return new Response(null, { status: Number(code) });
      }

      if (media.example !== undefined) {
        return Response.json(media.example, { status: Number(code) });
      }

      return Response.json(sample(getNode(media.schema), { quiet: true }, document), {
        status: Number(code),
      });
    },
    check: async (context) => {
      const loaded = loadSpec(context);

      // Routes-only mock: nothing to hold the routes against.
      if (spec === undefined) {
        return;
      }

      for (const [template, handlers] of Object.entries(routes)) {
        for (const method of Object.keys(handlers)) {
          if (loaded[template]?.[method] !== undefined) {
            continue;
          }

          const declared = Object.entries(loaded).flatMap(([candidate, methods]) => {
            return Object.keys(methods).map((entry) => {
              return `${entry} ${candidate}`;
            });
          });
          const closest = getClosest({ value: `${method} ${template}`, candidates: declared });

          throw createError({
            status: 500,
            message: `Route ${method} ${template} matches no operation of ${url}`,
            why: "The spec declares no such method and path, so the real API would reject this call",
            fix: `Did you mean ${closest}? Paths use the spec's {param} syntax and methods are upper-case`,
          });
        }
      }
    },
    pull: async (context) => {
      const written: string[] = [];

      for (const file of locate(context)) {
        if (!file.isRemote) {
          continue;
        }

        try {
          // `redirect: "error"`: a protected spec redirects to a login page, which
          // would otherwise be followed and fail later as unparseable JSON.
          const response = await fetch(file.entry, {
            headers: context.headers,
            redirect: "error",
          });

          if (!response.ok) {
            throw createError({
              status: 502,
              message: `OpenAPI spec download failed for ${file.entry}`,
              why: `The server answered ${response.status}`,
              fix: AUTH_HINT,
            });
          }

          mkdirSync(dirname(file.path), { recursive: true });
          writeFileSync(file.path, `${JSON.stringify(await response.json(), null, 2)}\n`);
          written.push(file.path);
        } catch (cause) {
          if (cause instanceof MockError) {
            throw cause;
          }

          throw createError({
            status: 502,
            message: `OpenAPI spec download failed for ${file.entry}`,
            why: "The server answered with a redirect, non-JSON body, or another fetch error; a protected spec redirects to its login page",
            fix: AUTH_HINT,
            cause,
          });
        }
      }

      return written;
    },
  };
}

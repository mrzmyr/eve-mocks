import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineHttpMock } from "./define-http-mock.ts";

const CONTEXT = { name: "shop" };

/** A one-operation OpenAPI document answering with `example`. */
function createSpec({ path, example }: { readonly path: string; readonly example: unknown }) {
  return {
    openapi: "3.1.0",
    paths: {
      [path]: {
        get: { responses: { 200: { content: { "application/json": { example } } } } },
      },
    },
  };
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "eve-mocks-"));
  mkdirSync(join(root, "mocks"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app/orders.json"), JSON.stringify(createSpec({ path: "/orders", example: { orders: 1 } })));
  writeFileSync(join(root, "app/users.json"), JSON.stringify(createSpec({ path: "/users", example: { users: 2 } })));
  process.env.EVE_MOCKS_DIR = join(root, "mocks");
});

afterAll(() => {
  rmSync(root, { recursive: true });
  delete process.env.EVE_MOCKS_DIR;
});

describe("defineHttpMock spec", () => {
  test("a local path is read in place, relative to the mocks directory", async () => {
    const mock = defineHttpMock({ url: "https://shop.example.com", spec: "../app/orders.json" });
    const response = await mock.handle(new Request("https://shop.example.com/orders"), CONTEXT);

    expect(await response.json()).toEqual({ orders: 1 });
    expect(await mock.pull?.({ ...CONTEXT, headers: {} })).toEqual([]);
  });

  test("an array merges the operations of its documents", async () => {
    const mock = defineHttpMock({
      url: "https://shop.example.com",
      spec: ["../app/orders.json", "../app/users.json"],
    });

    await mock.check?.(CONTEXT);

    const orders = await mock.handle(new Request("https://shop.example.com/orders"), CONTEXT);
    const users = await mock.handle(new Request("https://shop.example.com/users"), CONTEXT);

    expect(await orders.json()).toEqual({ orders: 1 });
    expect(await users.json()).toEqual({ users: 2 });
  });

  test("two documents declaring one operation stop the run", async () => {
    const mock = defineHttpMock({
      url: "https://shop.example.com",
      spec: ["../app/orders.json", "../app/orders.json"],
    });

    await expect(mock.check?.(CONTEXT)).rejects.toThrow("GET /orders is declared by two specs of shop");
  });

  test("a missing local spec names the resolved path", async () => {
    const mock = defineHttpMock({ url: "https://shop.example.com", spec: "../app/nope.json" });

    await expect(mock.check?.(CONTEXT)).rejects.toThrow(`No spec for shop at ${join(root, "app/nope.json")}`);
  });

  test("a URL is answered from its pulled schema file, numbered inside an array", async () => {
    const single = defineHttpMock({ url: "https://shop.example.com", spec: "https://shop.example.com/openapi.json" });
    const listed = defineHttpMock({
      url: "https://shop.example.com",
      spec: ["../app/orders.json", "https://shop.example.com/openapi.json"],
    });

    await expect(single.check?.(CONTEXT)).rejects.toThrow(
      `No schema for shop at ${join(root, "mocks/schemas/shop.openapi.json")}`,
    );
    await expect(single.check?.(CONTEXT)).rejects.toThrow("Run: eve-mocks pull shop");
    await expect(listed.check?.(CONTEXT)).rejects.toThrow(
      `No schema for shop at ${join(root, "mocks/schemas/shop.2.openapi.json")}`,
    );
  });

  test("a route must name an operation of the merged spec", async () => {
    const mock = defineHttpMock({
      url: "https://shop.example.com",
      spec: ["../app/orders.json", "../app/users.json"],
      routes: { "/user": { GET: () => ({}) } },
    });

    await expect(mock.check?.(CONTEXT)).rejects.toThrow("Did you mean GET /users?");
  });
});

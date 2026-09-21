import { describe, expect, test } from "bun:test";

import { isEveDevCommand, isEveDevUrl } from "./eve-dev.ts";

describe("isEveDevCommand", () => {
  test("matches eve as a path basename immediately followed by dev", () => {
    expect(isEveDevCommand({ command: ["eve", "dev"] })).toBe(true);
    expect(isEveDevCommand({ command: ["node_modules/.bin/eve", "dev"] })).toBe(true);
    expect(isEveDevCommand({ command: ["npx", "eve", "dev"] })).toBe(true);
    expect(isEveDevCommand({ command: ["eve", "dev", "--port", "3000"] })).toBe(true);
  });

  test("rejects any other command", () => {
    expect(isEveDevCommand({ command: ["eve", "eval"] })).toBe(false);
    expect(isEveDevCommand({ command: ["eve"] })).toBe(false);
    expect(isEveDevCommand({ command: ["vercel", "dev"] })).toBe(false);
    expect(isEveDevCommand({ command: ["bun", "run", "dev"] })).toBe(false);
    expect(isEveDevCommand({ command: ["some-eve", "dev"] })).toBe(false);
  });
});

describe("isEveDevUrl", () => {
  test("matches eve's control plane and telemetry prefixes", () => {
    expect(isEveDevUrl({ url: "https://api.vercel.com/v2/user" })).toBe(true);
    expect(isEveDevUrl({ url: "https://api.vercel.com/v1/teams" })).toBe(true);
    expect(isEveDevUrl({ url: "https://telemetry.vercel.com/api/vercel-cli/v1/events" })).toBe(true);
  });

  test("rejects any other host", () => {
    expect(isEveDevUrl({ url: "https://api.example.com/" })).toBe(false);
    expect(isEveDevUrl({ url: "https://api.vercel.com.evil.example/" })).toBe(false);
    expect(isEveDevUrl({ url: "http://api.vercel.com/v2/user" })).toBe(false);
  });
});

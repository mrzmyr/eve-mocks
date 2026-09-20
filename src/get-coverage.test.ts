import { describe, expect, test } from "bun:test";

import { allow } from "./allow.ts";
import { getCoverage } from "./get-coverage.ts";
import type { NamedMock } from "./load-mocks.ts";

/** A mock that claims `url`; coverage never calls it. */
function createMock({ name, url }: { readonly name: string; readonly url: string }): NamedMock {
  return { name, mock: { url, handle: async () => new Response() } };
}

describe("getCoverage", () => {
  test("matches a resolved dynamic connection by URL, whatever the mock file is called", () => {
    const rows = getCoverage({
      connections: [{ name: "logs", url: "https://logs.example.com/mcp", path: "/app/connections/logs.ts" }],
      mocks: [createMock({ name: "log-archive", url: "https://logs.example.com/" })],
      allowed: [],
    });

    expect(rows).toEqual([
      { name: "logs", status: "mocked", url: "https://logs.example.com/mcp", isConnection: true, isDynamic: true },
    ]);
  });

  test("reports a resolved dynamic connection without a mock as blocked", () => {
    const [row] = getCoverage({
      connections: [{ name: "vercel", url: "https://mcp.vercel.com", path: "/app/connections/vercel.ts" }],
      mocks: [],
      allowed: [],
    });

    expect(row?.status).toBe("blocked");
  });

  test("falls back to the mock name for a dynamic connection without a URL", () => {
    const connections = [{ name: "tenant-api", path: "/app/connections/tenant-api.ts" }];

    expect(getCoverage({ connections, mocks: [], allowed: [] })[0]?.status).toBe("blocked");
    expect(
      getCoverage({ connections, mocks: [createMock({ name: "tenant-api", url: "https://t.example.com" })], allowed: [] })[0]?.status,
    ).toBe("mocked");
  });

  test("lets a mock win over an allow entry, and lists an allow entry no connection uses", () => {
    const rows = getCoverage({
      connections: [
        { name: "tracker", url: "https://tracker.example.com/mcp", protocol: "mcp" },
        { name: "reports", url: "https://reports.example.com/api", protocol: "openapi" },
      ],
      mocks: [createMock({ name: "tracker", url: "https://tracker.example.com/" })],
      allowed: [
        allow({ url: "https://tracker.example.com/" }),
        allow({ url: "https://reports.example.com/" }),
        allow({ url: "https://ai-gateway.vercel.sh/" }),
      ],
    });

    expect(
      rows.map(({ name, status, isConnection }) => {
        return { name, status, isConnection };
      }),
    ).toEqual([
      { name: "ai-gateway.vercel.sh", status: "allowed", isConnection: false },
      { name: "reports", status: "allowed", isConnection: true },
      { name: "tracker", status: "mocked", isConnection: true },
      { name: "tracker.example.com", status: "allowed", isConnection: false },
    ]);
  });
});

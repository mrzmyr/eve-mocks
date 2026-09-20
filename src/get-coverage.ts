import type { NamedMock } from "./load-mocks.ts";
import type { Connection } from "./read-manifest.ts";
import type { Allowed, CallRecord, UpstreamType } from "./types.ts";

/**
 * What a call to the upstream does under `--mocks`, in the words the run
 * summary uses. `blocked` includes a dynamic connection whose URL is unknown:
 * deny by default does not need the URL.
 */
export type CoverageStatus = CallRecord["outcome"];

/** One row of `eve-mocks list`. */
export type Coverage = {
  /** Connection name; for a mock or allow entry no connection matches, its file name or host. */
  readonly name: string;
  /** What a call to the upstream does under `--mocks`. */
  readonly status: CoverageStatus;
  /** Production URL, when known. */
  readonly url?: string;
  /**
   * What the upstream speaks. From the connection's protocol, else from the mock
   * that answers it; absent for an allow entry and for a dynamic connection
   * that has neither.
   */
  readonly type?: UpstreamType;
  /** False for a mock or allow entry that matches no eve connection, such as a token endpoint. */
  readonly isConnection: boolean;
  /** True for a dynamic connection, which eve registers when a session starts. */
  readonly isDynamic: boolean;
};

/**
 * Match the app's connections against its mocks.
 *
 * A static connection is matched by URL: either prefix may be the longer one,
 * since a mock can claim a whole host while the connection names a path on it.
 * A dynamic connection is matched the same way once `resolveConnections` found
 * its URL; one that still has none is matched by mock name.
 *
 * A mock wins over an allow entry, as it does for a call. An allow entry
 * covers a connection only when it is a prefix of the connection's URL: a
 * narrower entry would let some of its calls through and block the rest.
 */
export function getCoverage({
  connections,
  mocks,
  allowed,
}: {
  readonly connections: readonly Connection[];
  readonly mocks: readonly NamedMock[];
  readonly allowed: readonly Allowed[];
}): Coverage[] {
  const matched = new Set<NamedMock | Allowed>();

  const rows = connections.map(({ name, url, path, protocol }): Coverage => {
    const isDynamic = path !== undefined;
    const hits = mocks.filter(({ name: mockName, mock }) => {
      if (url === undefined) {
        return mockName === name;
      }

      return url.startsWith(mock.url) || mock.url.startsWith(url);
    });

    for (const hit of hits) {
      matched.add(hit);
    }

    const [hit] = hits;
    // The manifest says `openapi` for every HTTP API; a mock knows its own type.
    let type = hit?.mock.type;

    if (protocol !== undefined) {
      type = "http";

      if (protocol === "mcp") {
        type = "mcp";
      }
    }

    // Spread, not assigned: `exactOptionalPropertyTypes` rejects an explicit undefined.
    const base = { name, isConnection: true, isDynamic, ...(type !== undefined && { type }) };

    if (url === undefined) {
      if (hit) {
        return { ...base, status: "mocked", url: hit.mock.url };
      }

      return { ...base, status: "blocked" };
    }

    if (hit) {
      return { ...base, status: "mocked", url };
    }

    const passes = allowed.filter((entry) => {
      return url.startsWith(entry.url);
    });

    for (const pass of passes) {
      matched.add(pass);
    }

    if (passes.length > 0) {
      return { ...base, status: "allowed", url };
    }

    return { ...base, status: "blocked", url };
  });

  for (const entry of mocks) {
    if (!matched.has(entry)) {
      rows.push({
        name: entry.name,
        status: "mocked",
        url: entry.mock.url,
        type: entry.mock.type,
        isConnection: false,
        isDynamic: false,
      });
    }
  }

  for (const entry of allowed) {
    if (!matched.has(entry)) {
      rows.push({ name: new URL(entry.url).host, status: "allowed", url: entry.url, isConnection: false, isDynamic: false });
    }
  }

  return rows.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });
}

import type { NamedMock } from "./load-mocks.ts";
import type { Connection } from "./read-manifest.ts";

/** Whether a connection's upstream is mocked. */
export type CoverageStatus =
  /** A mock answers this upstream. */
  | "SUPPORTED"
  /** No mock claims the connection's URL; a call under `--mocks` throws unless allowed. */
  | "NOT_SUPPORTED"
  /** Dynamic connection without a mock. Its URL is unknown here; a call still throws unless allowed. */
  | "UNKNOWN_URL";

/** One row of `eve-mocks list`. */
export type Coverage = {
  /** Connection name, or the mock's file name when no connection matches it. */
  readonly name: string;
  /** Whether the upstream is mocked. */
  readonly status: CoverageStatus;
  /** Production URL, when known. */
  readonly url?: string;
  /** False for a mock that matches no eve connection, such as a token endpoint. */
  readonly isConnection: boolean;
};

/**
 * Match the app's connections against its mocks.
 *
 * A static connection is matched by URL: either prefix may be the longer one,
 * since a mock can claim a whole host while the connection names a path on it.
 * A dynamic connection has no URL to compare, so it is matched by mock name.
 */
export function getCoverage({
  connections,
  mocks,
}: {
  readonly connections: readonly Connection[];
  readonly mocks: readonly NamedMock[];
}): Coverage[] {
  const matched = new Set<NamedMock>();

  const rows = connections.map(({ name, url }): Coverage => {
    const hits = mocks.filter(({ name: mockName, mock }) => {
      if (url === undefined) {
        return mockName === name;
      }

      return url.startsWith(mock.url) || mock.url.startsWith(url);
    });

    for (const hit of hits) {
      matched.add(hit);
    }

    if (url === undefined) {
      const [hit] = hits;

      if (hit) {
        return { name, status: "SUPPORTED", url: hit.mock.url, isConnection: true };
      }

      return { name, status: "UNKNOWN_URL", isConnection: true };
    }

    if (hits.length > 0) {
      return { name, status: "SUPPORTED", url, isConnection: true };
    }

    return { name, status: "NOT_SUPPORTED", url, isConnection: true };
  });

  for (const entry of mocks) {
    if (!matched.has(entry)) {
      rows.push({ name: entry.name, status: "SUPPORTED", url: entry.mock.url, isConnection: false });
    }
  }

  return rows.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });
}

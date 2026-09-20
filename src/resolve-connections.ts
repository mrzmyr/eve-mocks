import { captureConnections, type CapturedConnection } from "./capture-connections.ts";
import { createError, MockError } from "./errors.ts";
import type { Connection } from "./read-manifest.ts";

/**
 * Fill in the URL and protocol of every dynamic connection whose module
 * constructs one while it loads, then deduplicate by name and URL.
 *
 * A module that cannot be imported outside eve, or that builds its connection
 * inside the `session.started` handler, keeps its connection without a URL. A
 * failed import is reported on stderr and does not stop the others.
 */
export async function resolveConnections({
  connections,
}: {
  readonly connections: readonly Connection[];
}): Promise<Connection[]> {
  // Node evaluates a module once, and subagents can share one: keep the first capture.
  const byPath = new Map<string, readonly CapturedConnection[]>();
  const seen = new Set<string>();
  const resolved: Connection[] = [];

  // One at a time: the capture buffer is shared by the process.
  for (const connection of connections) {
    let entry = connection;

    if (connection.url === undefined && connection.path !== undefined) {
      let found = byPath.get(connection.path);

      if (found === undefined) {
        try {
          found = await captureConnections({ path: connection.path });
        } catch (error) {
          // Our own error means no module can be captured; only the app's import failures are survivable.
          if (error instanceof MockError) {
            throw error;
          }

          found = [];

          const warning = createError({
            status: 422,
            message: `Cannot read the URL of "${connection.name}"`,
            why: `Importing ${connection.path} failed: ${String(error)}`,
            fix: "Make the module importable outside eve, such as by reading the environment inside the handler; until then match its mock by file name",
            cause: error,
          });

          console.error(`eve-mocks: ${warning.message}`);
        }

        byPath.set(connection.path, found);
      }

      const [first] = found;

      if (first) {
        entry = { ...connection, url: first.url, protocol: first.protocol };
      }
    }

    const key = `${entry.name} ${entry.url}`;

    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(entry);
    }
  }

  return resolved;
}

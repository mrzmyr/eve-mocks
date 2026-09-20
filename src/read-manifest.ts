import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createError } from "./errors.ts";
import { readJson } from "./read-json.ts";

/** A connection the eve app declares, as its compiled manifest lists it. */
export type Connection = {
  /** Connection name, such as `catalog`. */
  readonly name: string;
  /**
   * Production URL. Absent for a dynamic connection: eve registers those at
   * `session.started`, so the manifest holds their name only.
   */
  readonly url?: string;
  /** `openapi` or `mcp`. Absent for a dynamic connection. */
  readonly protocol?: string;
  /** Absolute path of the module that defines a dynamic connection. */
  readonly path?: string;
};

/** Where eve writes the manifest, relative to the app root. See https://eve.dev/docs/reference/cli */
export const MANIFEST_PATH = ".eve/compile/compiled-agent-manifest.json";

/**
 * Manifest schema version this reader was written against. eve documents the
 * file's path but not its fields, so the shape is checked on every read.
 */
const TESTED_VERSION = 45;

/** A JSON object node of the manifest. */
type Node = { readonly [key: string]: unknown };

/** Whether `value` is a JSON object, not an array or `null`. */
function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The error for a manifest this reader cannot trust. Guarding with half the
 * data would let unmocked connections reach production, so every shape
 * mismatch ends here instead of being skipped.
 */
function createShapeError({ detail, version }: { readonly detail: string; readonly version: unknown }) {
  return createError({
    status: 500,
    message: "eve's compiled manifest has an unknown shape",
    why: `${detail}. eve-mocks was tested against manifest version ${TESTED_VERSION}; found ${String(version)}`,
    fix: "Upgrade eve-mocks, or pin eve to a version eve-mocks was tested with",
  });
}

/** Connections of one agent node and, recursively, of its subagents. */
function collect({ agent, version }: { readonly agent: Node; readonly version: unknown }): Connection[] {
  const { agentRoot, connections, dynamicConnections, subagents = [] } = agent;

  if (
    typeof agentRoot !== "string" ||
    !Array.isArray(connections) ||
    !Array.isArray(dynamicConnections) ||
    !Array.isArray(subagents)
  ) {
    throw createShapeError({
      detail: "An agent lacks agentRoot, or the connections, dynamicConnections, or subagents array",
      version,
    });
  }

  const found: Connection[] = [];

  for (const entry of connections) {
    if (
      !isNode(entry) ||
      typeof entry.connectionName !== "string" ||
      typeof entry.url !== "string" ||
      typeof entry.protocol !== "string"
    ) {
      throw createShapeError({ detail: "A connection lacks connectionName, url, or protocol", version });
    }

    found.push({ name: entry.connectionName, url: entry.url, protocol: entry.protocol });
  }

  for (const entry of dynamicConnections) {
    if (!isNode(entry) || typeof entry.slug !== "string" || typeof entry.logicalPath !== "string") {
      throw createShapeError({ detail: "A dynamic connection lacks slug or logicalPath", version });
    }

    // `logicalPath` is relative to the agent that owns the connection, not to the app.
    found.push({ name: entry.slug, path: join(agentRoot, entry.logicalPath) });
  }

  for (const entry of subagents) {
    if (!isNode(entry) || !isNode(entry.agent)) {
      throw createShapeError({ detail: "A subagent lacks its agent node", version });
    }

    found.push(...collect({ agent: entry.agent, version }));
  }

  return found;
}

/**
 * Every connection of the eve app and its subagents. Subagents repeat
 * connections; `resolveConnections` deduplicates once URLs are known.
 *
 * @param input.root - App root, where `.eve/` lives.
 * @throws MockError 404 when eve has not compiled the app yet, 500 when the
 *   manifest does not have the shape this reader was tested against.
 */
export function readManifest({ root }: { readonly root: string }): Connection[] {
  const path = join(root, MANIFEST_PATH);

  if (!existsSync(path)) {
    throw createError({
      status: 404,
      message: `No compiled eve manifest at ${MANIFEST_PATH}`,
      why: "eve-mocks reads the app's connections from it to find the ones without a mock, and eve writes it on compile",
      fix: "Run `eve info` once, then rerun",
    });
  }

  const manifest = readJson({ path, fix: "Recompile the app with `eve info`, then rerun" });

  if (!isNode(manifest) || manifest.kind !== "eve-agent-compiled-manifest") {
    throw createShapeError({ detail: "The file is not an eve-agent-compiled-manifest", version: undefined });
  }

  const connections = collect({ agent: manifest, version: manifest.version });

  // After `collect`, so the warning only shows for a shape that passed the check.
  if (typeof manifest.version === "number" && manifest.version > TESTED_VERSION) {
    console.error(
      `eve-mocks: manifest version ${manifest.version} is newer than the tested ${TESTED_VERSION}; its shape still checks out`,
    );
  }

  return connections;
}

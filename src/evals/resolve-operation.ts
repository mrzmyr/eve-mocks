import { createError } from "../errors.ts";
import { getClosest } from "../get-closest.ts";
import { getMocksDir } from "../get-mocks-dir.ts";
import { loadMocks, type NamedMock } from "../load-mocks.ts";

/** An operation string resolved to the mock that declares it. */
export type ResolvedOperation = {
  /** The mock's file name. */
  readonly mock: string;
  /** The operation as the mock spells it: tool name, or `METHOD /template`. */
  readonly key: string;
};

/** Separates an explicit mock name from the operation: `linear:get_issue`. */
const SEPARATOR = ":";

let loaded: Promise<readonly NamedMock[]> | undefined;

/** Every mock of the mocks directory, loaded once per process. */
function loadAll(): Promise<readonly NamedMock[]> {
  if (loaded === undefined) {
    loaded = loadMocks({ dir: getMocksDir({ name: "mock()" }) }).then(({ mocks }) => {
      return mocks;
    });
  }

  return loaded;
}

/** `post /v1/search` as `POST /v1/search`; a tool name unchanged. */
function normalize({ operation }: { readonly operation: string }): string {
  const space = operation.indexOf(" ");

  if (space === -1) {
    return operation;
  }

  return `${operation.slice(0, space).toUpperCase()} ${operation.slice(space + 1)}`;
}

/**
 * Find the mock that declares `operation`.
 *
 * `linear:get_issue` names the mock. Without a name, every mock's schema is
 * searched; the operation must exist in exactly one.
 *
 * @throws MockError when no mock declares it, more than one does, or the
 *   named mock does not exist.
 */
export async function resolveOperation({ operation }: { readonly operation: string }): Promise<ResolvedOperation> {
  const mocks = await loadAll();
  const separator = operation.indexOf(SEPARATOR);
  let name: string | undefined;
  let key = normalize({ operation });

  // A path never starts with `:`, and a tool name never contains one.
  if (separator > 0 && !operation.slice(0, separator).includes(" ")) {
    name = operation.slice(0, separator);
    key = normalize({ operation: operation.slice(separator + 1) });
  }

  const declared = mocks.flatMap(({ name: mock, mock: entry }) => {
    if (name !== undefined && mock !== name) {
      return [];
    }

    return (entry.operations?.({ name: mock }) ?? []).map((candidate) => {
      return { mock, key: candidate };
    });
  });

  if (name !== undefined && !mocks.some((entry) => entry.name === name)) {
    const closest = getClosest({ value: name, candidates: mocks.map((entry) => entry.name) });

    throw createError({
      status: 404,
      message: `No mock named ${name}`,
      why: `mock(t, "${operation}") names a mock file, and mocks/${name}.ts does not exist`,
      fix: `Did you mean ${closest}? The name before ":" is a file in the mocks directory`,
    });
  }

  const matches = declared.filter((candidate) => {
    return candidate.key === key;
  });

  if (matches.length === 1) {
    return matches[0] as ResolvedOperation;
  }

  if (matches.length > 1) {
    const options = matches.map(({ mock }) => {
      return `"${mock}${SEPARATOR}${key}"`;
    });

    throw createError({
      status: 409,
      message: `${key} is declared by ${matches.length} mocks`,
      why: `${matches.map(({ mock }) => mock).join(" and ")} both declare it, so mock(t, "${operation}") cannot tell which to answer for`,
      fix: `Name the mock: mock(t, ${options.join(" or ")}, …)`,
    });
  }

  const closest = getClosest({
    value: key,
    candidates: declared.map((candidate) => {
      return candidate.key;
    }),
  });
  let fix = "Check the schema files under mocks/schemas; refresh them with eve-mocks pull";

  if (closest !== undefined) {
    fix = `Did you mean ${closest}? Tool names as the server lists them; HTTP operations as "METHOD /path" with the spec's {param} syntax`;
  }

  throw createError({
    status: 404,
    message: `${key} matches no operation of any mock`,
    why: "No schema file declares it, so the agent could never call it",
    fix,
  });
}

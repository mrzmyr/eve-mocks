import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createError } from "./errors.ts";

/** What a connection module hands to one of eve's connection constructors. */
export type CapturedConnection = {
  /** Production URL the connection was constructed with. */
  readonly url: string;
  /** `openapi` or `mcp`, by the constructor that was called. */
  readonly protocol: string;
};

/** The module eve's connection constructors are imported from. See https://eve.dev/docs/connections */
const TARGET = "eve/connections";

/**
 * eve's connection constructors and the manifest protocol each stands for. A
 * constructor eve adds later is not wrapped, so its connections keep an
 * unknown URL until it is listed here.
 */
const CONSTRUCTORS = {
  defineMcpClientConnection: "mcp",
  defineOpenAPIConnection: "openapi",
};

/** Marks the wrapper's URL, so its own import of {@link TARGET} reaches the real module. */
const WRAPPED = "?eve-mocks-capture";

/** Global the wrapper reports to: it is loaded as source and cannot import from here. */
const REPORTER = "__eveMocksCapture";

/**
 * Extensions tried for a relative import Node cannot resolve. eve apps are
 * written for bundler resolution: extensionless, or `.js` for a `.ts` file.
 * See https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler
 */
const SOURCE_EXTENSIONS = [".ts", ".mts", ".tsx"];

const captured: CapturedConnection[] = [];
let isHooked = false;

/** Source of the module that stands in for {@link TARGET}. */
function createWrapper(): string {
  const wrapped = Object.entries(CONSTRUCTORS).map(([name, protocol]) => {
    return `export const ${name} = (input) => {
      globalThis.${REPORTER}({ url: input?.url, protocol: "${protocol}" });
      return real.${name}(input);
    };`;
  });

  return `import * as real from "${TARGET}";\nexport * from "${TARGET}";\n${wrapped.join("\n")}`;
}

/** File URL of the source file a bundler would pick for a relative import, if one exists. */
function findSource({ specifier, parentURL }: { readonly specifier: string; readonly parentURL: string }): string | undefined {
  const base = fileURLToPath(new URL(specifier, parentURL));
  const stems = [base];

  if (base.endsWith(".js")) {
    stems.push(base.slice(0, -".js".length));
  }

  for (const stem of stems) {
    for (const extension of SOURCE_EXTENSIONS) {
      if (existsSync(`${stem}${extension}`)) {
        return pathToFileURL(`${stem}${extension}`).href;
      }
    }
  }

  return undefined;
}

/** Route every import of {@link TARGET} in this process through the wrapper. */
function hook(): void {
  if (isHooked) {
    return;
  }

  // Bun has no synchronous module hooks; the CLI runs on Node.
  // See https://nodejs.org/api/module.html#moduleregisterhooksoptions
  if (typeof nodeModule.registerHooks !== "function") {
    throw createError({
      status: 500,
      message: "Cannot read the URLs of dynamic connections",
      why: "This runtime has no module.registerHooks, which eve-mocks uses to see the URL a connection module constructs",
      fix: "Run eve-mocks on Node 22.15 or newer",
      link: "https://nodejs.org/api/module.html#moduleregisterhooksoptions",
    });
  }

  Object.assign(globalThis, {
    [REPORTER]: ({ url, protocol }: { readonly url: unknown; readonly protocol: string }) => {
      if (typeof url === "string") {
        captured.push({ url, protocol });
      }
    },
  });

  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === TARGET && !context.parentURL?.endsWith(WRAPPED)) {
        const real = nextResolve(specifier, context);

        return { ...real, url: `${real.url}${WRAPPED}`, shortCircuit: true };
      }

      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
          const source = findSource({ specifier, parentURL: context.parentURL });

          if (source !== undefined) {
            return nextResolve(source, context);
          }
        }

        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (url.endsWith(WRAPPED)) {
        return { format: "module", source: createWrapper(), shortCircuit: true };
      }

      return nextLoad(url, context);
    },
  });

  isHooked = true;
}

/**
 * The connections a module constructs while it loads.
 *
 * A dynamic connection has no URL in eve's manifest, but its module still
 * passes one to an eve constructor, usually at top level. Importing the module
 * with those constructors wrapped reads that URL without starting a session,
 * so whatever the `session.started` handler checks does not matter.
 *
 * Empty when the module builds its connection inside the handler, and when
 * the module was imported before: Node evaluates a module once. Call it one
 * module at a time; the capture buffer is shared by the process.
 *
 * @param input.path - Absolute path of the connection module.
 * @throws MockError 500 on a runtime without `module.registerHooks`.
 */
export async function captureConnections({ path }: { readonly path: string }): Promise<CapturedConnection[]> {
  hook();
  captured.length = 0;

  await import(pathToFileURL(path).href);

  return [...captured];
}

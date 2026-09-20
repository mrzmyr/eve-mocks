/** What eve-mocks tells a mock about itself when it calls it. */
export type MockContext = {
  /** The mock's file name without extension; names its schema file. */
  readonly name: string;
};

/**
 * One mocked upstream: every `fetch` whose URL starts with `url` is answered
 * by `handle` inside the calling process, so no request leaves the machine.
 */
export type Mock = {
  /** Production URL prefix the agent calls. */
  readonly url: string;
  /** Answers one intercepted request. */
  readonly handle: (request: Request, context: MockContext) => Promise<Response>;
  /**
   * Environment variables the mocked code path reads before it fetches.
   * Applied only where the variable is unset, so a real value always wins.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Checks the mock against its schema file, such as route keys against the spec.
   * The CLI runs it once before a command starts; the preload does not, so the
   * processes of a run do not each pay for it.
   *
   * @throws MockError when the mock and its schema file disagree.
   */
  readonly check?: (context: MockContext) => Promise<void>;
  /**
   * Refreshes the mock's schema file from the real upstream.
   *
   * @returns The path written, or `undefined` when the mock names no source.
   */
  readonly pull?: (context: PullContext) => Promise<string | undefined>;
};

/** What `eve-mocks pull` tells a mock. */
export type PullContext = MockContext & {
  /** Headers from `--header` flags. They win over the mock's `pull.headers`. */
  readonly headers: Readonly<Record<string, string>>;
};

/** How `eve-mocks pull` reaches the real upstream. */
export type PullOptions = {
  /**
   * Request headers, such as auth. Must be self-contained: read the
   * environment, do not import app code. Mock files load under Node type
   * stripping, which cannot resolve an app's extensionless imports.
   */
  readonly headers?: () => Promise<Record<string, string>>;
};

/** What a route handler receives. */
export type RouteContext = {
  /** The intercepted request, with its production URL. */
  readonly request: Request;
  /** Values of the path's `{param}` segments. */
  readonly params: Readonly<Record<string, string>>;
};

/** Returns a `Response`, or any JSON value sent as 200. */
export type RouteHandler = (context: RouteContext) => unknown;

/**
 * Pinned answers: path, then method. Paths use the OpenAPI `{param}` syntax so
 * they copy from the spec; methods are upper-case, as in `Request.method`.
 */
export type Routes = Readonly<Record<string, Readonly<Record<string, RouteHandler>>>>;

/** A real upstream that stays reachable while the mocks are on. */
export type Allowed = {
  /** URL prefix that may be reached. */
  readonly url: string;
  /** Tells an allow entry from a mock in a file's default export. */
  readonly isAllowed: true;
};

/** Returns the JSON a tool call answers with; receives the call's arguments. */
export type ToolResult = (args: Record<string, unknown>) => unknown;

/** One intercepted call, as the preload appends it to the call log. */
export type CallRecord = {
  /**
   * `mocked`: a mock answered. `allowed`: sent to the real upstream.
   * `blocked`: neither mocked nor allowed, so the call threw.
   */
  readonly outcome: "mocked" | "allowed" | "blocked";
  /** Mock file name for a mocked call, else the host that was called. */
  readonly target: string;
  /** HTTP method of the intercepted request. */
  readonly method: string;
  /** Production URL the agent asked for. */
  readonly url: string;
};

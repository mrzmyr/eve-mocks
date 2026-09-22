/** Protocol of an upstream, as `list` names it. */
export type UpstreamType = "mcp" | "http";

/** A remote document with the local copy `eve-mocks pull` saved. */
export type MockDocument = {
  /** URL the document is published at. */
  readonly url: string;
  /** Absolute path of the pulled copy. */
  readonly path: string;
};

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
  /** What the upstream speaks: an MCP server, or any other HTTP API. Shown by `list`. */
  readonly type: UpstreamType;
  /** Answers one intercepted request. */
  readonly handle: (request: Request, context: MockContext) => Promise<Response>;
  /**
   * Remote documents this mock holds a pulled copy of, such as its OpenAPI
   * spec. A request for one is answered from the copy: an eve connection whose
   * `spec` is a URL downloads it at run time, from a host the mock does not claim.
   */
  readonly documents?: (context: MockContext) => readonly MockDocument[];
  /**
   * Environment variables the mocked code path reads before it fetches.
   * Applied only where the variable is unset, so a real value always wins.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Every operation the schema file declares: tool names for an MCP server,
   * `METHOD /path` for an HTTP API. What `mock()` in an eval may name.
   */
  readonly operations?: (context: MockContext) => readonly string[];
  /**
   * Checks the mock against its schema file, such as route keys against the spec.
   * The CLI runs it once before a command starts; the preload does not, so the
   * processes of a run do not each pay for it.
   *
   * @throws MockError when the mock and its schema file disagree.
   */
  readonly check?: (context: MockContext) => Promise<void>;
  /**
   * Refreshes the mock's schema files from the real upstream.
   *
   * @returns The paths written; none when the mock has nothing remote to pull.
   */
  readonly pull?: (context: PullContext) => Promise<readonly string[]>;
};

/** What the MCP inspector's schema lint counted over a pulled `tools/list`. */
export type PullLint = {
  /** Schemas a client could not use. */
  readonly errors: number;
  /** Schemas some clients read differently. */
  readonly warnings: number;
};

/** What `eve-mocks pull` tells a mock. */
export type PullContext = MockContext & {
  /** Headers from `--header` flags, such as auth for a protected upstream. */
  readonly headers: Readonly<Record<string, string>>;
  /** Receives the lint counts of a pulled document, which the CLI prints with the files written. */
  readonly onLint?: (lint: PullLint) => void;
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
   * `mock`: a mock answered. `allow`: sent to the real upstream.
   * `block`: neither mocked nor allowed, so the call threw.
   */
  readonly outcome: "mock" | "allow" | "block";
  /** Name of the mock or allow entry that matched, else the host that was called. */
  readonly target: string;
  /** Tool an MCP `tools/call` named. Absent for every other request. */
  readonly tool?: string;
  /** HTTP method of the intercepted request. */
  readonly method: string;
  /** Production URL the agent asked for. */
  readonly url: string;
};

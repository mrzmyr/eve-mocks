/** Fields every eve-mocks error carries. */
export type MockErrorInput = {
  /** HTTP-style status code. */
  readonly status: number;
  /** What went wrong. */
  readonly message: string;
  /** Why it went wrong. */
  readonly why: string;
  /** How to resolve it. */
  readonly fix: string;
  /** Optional link to documentation. */
  readonly link?: string;
  /** Optional underlying cause. */
  readonly cause?: unknown;
};

/** Error with operator guidance; `why` and `fix` are printed with the message. */
export class MockError extends Error {
  /** HTTP-style status code. */
  readonly status: number;
  /** Why it went wrong. */
  readonly why: string;
  /** How to resolve it. */
  readonly fix: string;
  /** Optional link to documentation. */
  readonly link?: string;

  /**
   * @param input - The status, message, and operator guidance for this error.
   */
  constructor({ status, message, why, fix, link, cause }: MockErrorInput) {
    super(`${message}\n  why: ${why}\n  fix: ${fix}`, { cause });
    this.name = "MockError";
    this.status = status;
    this.why = why;
    this.fix = fix;

    if (link !== undefined) {
      this.link = link;
    }
  }
}

/**
 * Construct a {@link MockError}.
 *
 * @param input - The status, message, and operator guidance for this error.
 */
export function createError(input: MockErrorInput): MockError {
  return new MockError(input);
}

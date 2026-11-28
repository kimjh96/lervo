/** A finite collector bound was exceeded; the pass stops without deletion authority (ADR-0584). */
export class CasRetentionBoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CasRetentionBoundError";
  }
}

/**
 * ADR-0658: why one reference path stops a pass. A pass that cannot read a file or directory, or
 * meets a link or a special file, deletes nothing, and it names the path so the stop is visible.
 */
export type CasRetentionReferenceFailure =
  "unreadable_reference" | "unsafe_reference" | "unsupported_reference" | "unstable_reference";

export class CasRetentionReferenceError extends Error {
  constructor(
    readonly failure: CasRetentionReferenceFailure,
    /** Absolute; the observation records it relative to the repository. */
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(`CAS retention stopped at a reference path: ${failure}.`, options);
    this.name = "CasRetentionReferenceError";
  }
}

/** Permission errors become a named, visible stop instead of an anonymous failure. */
export function unreadable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EACCES" || code === "EPERM";
}

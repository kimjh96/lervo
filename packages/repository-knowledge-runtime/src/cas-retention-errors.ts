/** A finite collector bound was exceeded; the pass stops without deletion authority (ADR-0584). */
export class CasRetentionBoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CasRetentionBoundError";
  }
}

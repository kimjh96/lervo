import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";

/**
 * What an unchanged skip compares. An unresolved preflight block holds new proposals until an
 * event resolves it; that event is not part of the source digest, so the block's identity joins it.
 */
export function supervisionCursorDigest(
  sourceRevisionDigest: string,
  preflightBlock: string | null,
): string {
  return preflightBlock === null
    ? sourceRevisionDigest
    : operatingContractHash({ source: sourceRevisionDigest, preflightBlock });
}

type Cursor = { digest: string; nextCheckAt: string | null; blocked: boolean };

/**
 * Bounded per-supervision memory of the last settled source. An unchanged source is skipped until
 * its next check; a blocked source stays blocked so later skips never read as healthy idleness.
 */
export class SupervisionCycleCursors {
  private readonly cursors = new Map<string, Cursor>();

  has(supervisionId: string): boolean {
    return this.cursors.has(supervisionId);
  }

  nextCheckAt(supervisionId: string): number | null {
    const next = this.cursors.get(supervisionId)?.nextCheckAt;
    return next == null ? null : Date.parse(next);
  }

  /** The disposition to repeat for an unchanged source, or null when the cycle must run. */
  unchanged(supervisionId: string, digest: string, now: string): "idle" | "blocked" | null {
    const previous = this.cursors.get(supervisionId);
    if (
      previous === undefined ||
      previous.digest !== digest ||
      (previous.nextCheckAt !== null && Date.parse(previous.nextCheckAt) <= Date.parse(now))
    )
      return null;
    return previous.blocked ? "blocked" : "idle";
  }

  /** Allows one bounded startup grace period before evaluating an unchanged bound goal. */
  defer(supervisionId: string, digest: string, now: string): void {
    this.set(supervisionId, {
      digest,
      nextCheckAt: new Date(Date.parse(now) + 60_000).toISOString(),
      blocked: false,
    });
  }

  /** `digest` is what later cycles compare; it defaults to the report's source digest. */
  remember(
    supervisionId: string,
    report: OutcomeSupervisionReportV1,
    expiresAt: string,
    blocked = false,
    digest = report.sourceRevisionDigest,
  ): void {
    this.set(supervisionId, {
      digest,
      blocked,
      nextCheckAt:
        report.nextCheckAt !== null && Date.parse(report.nextCheckAt) < Date.parse(expiresAt)
          ? report.nextCheckAt
          : expiresAt,
    });
  }

  private set(supervisionId: string, cursor: Cursor): void {
    this.cursors.delete(supervisionId);
    this.cursors.set(supervisionId, cursor);
    while (this.cursors.size > 256) this.cursors.delete(this.cursors.keys().next().value!);
  }
}

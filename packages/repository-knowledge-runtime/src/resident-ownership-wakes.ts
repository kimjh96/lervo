import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { readProviderCliProjection } from "./provider-cli-projection.js";

/**
 * Whether a change of this checkout's provider admission record wakes an ineligible resident at
 * once: the record no longer says that no provider is admitted, as after an explicit probe cleared
 * a failure, so the next observation may contend. A record that still waits keeps the scheduled
 * wake, so the host's own admission writes never loop the resident.
 */
export function providerAdmissionWakes(
  verdict: Pick<ConvergenceOwnerVerdict, "role"> | null,
  projection: { waiting: boolean } | null,
): boolean {
  return verdict?.role === "ineligible" && (projection === null || !projection.waiting);
}

/**
 * The resident's wakes for ownership state another process changed: this checkout's owner fence,
 * and its provider admission record.
 */
export function residentOwnershipWakes(input: {
  root: string;
  signal: AbortSignal;
  trigger: { running(): Promise<void> | null; wakeNow(): void; again(): void };
  verdict: () => ConvergenceOwnerVerdict | null;
  /** The observation in flight, so a fence its own write caused compares with its verdict. */
  observing: () => Promise<unknown>;
  observeOwnership: () => Promise<unknown>;
  onFailure: (error: unknown) => void;
}): { onOwnerFence: () => void; onProviderAdmission: () => void } {
  const { root, signal, trigger } = input;
  return {
    // ADR-0602: a release command in another process rewrites this checkout's fence; the
    // resident's own observations write the verdict it already holds and are ignored.
    onOwnerFence: () => {
      input
        .observing()
        .then(() => readConvergenceOwnerFence(root))
        .then((fence) => {
          const written = fence?.verdict ?? null;
          const verdict = input.verdict();
          if (written === null || signal.aborted) return;
          if (written.observedAt === verdict?.observedAt && written.role === verdict.role) return;
          if (trigger.running() !== null) input.observeOwnership().catch(input.onFailure);
          trigger.wakeNow();
        }, input.onFailure);
    },
    // An ineligible host looks at ownership again once its admission record no longer holds a
    // provider failure, as after an explicit probe cleared it, instead of an hour later.
    onProviderAdmission: () => {
      readProviderCliProjection(root).then((projection) => {
        if (signal.aborted || !providerAdmissionWakes(input.verdict(), projection)) return;
        if (trigger.running() !== null) trigger.again();
        else trigger.wakeNow();
      }, input.onFailure);
    },
  };
}

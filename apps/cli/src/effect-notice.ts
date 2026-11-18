import { recordEffectNotice } from "@lervo/project";

/**
 * ADR-0561 step three for an effect without a commit of its own: one after-the-fact notice in the
 * effect notice journal, which the ADR-0549 learned notice reports. A notice that cannot be
 * recorded is lost; it never fails or undoes the effect it describes.
 */
export async function noticeEffect(input: {
  repositoryRoot: string;
  effect: string;
  /** A bounded identifier unique to this application, such as a backup or plan ID. */
  subject: string;
  targets: readonly string[];
  reason: string;
  reviewers: readonly string[];
  verdict: string;
  undo: string;
  now?: Date;
}): Promise<void> {
  await recordEffectNotice(input.repositoryRoot, {
    noticeId: `${input.effect}:${input.subject}`,
    occurredAt: (input.now ?? new Date()).toISOString(),
    effect: input.effect,
    targets: [...input.targets],
    reason: input.reason,
    crossCheck: { reviewers: [...input.reviewers], verdict: input.verdict },
    undo: input.undo,
  }).catch(() => undefined);
}

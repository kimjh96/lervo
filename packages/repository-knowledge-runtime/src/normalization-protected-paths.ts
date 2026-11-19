/**
 * ADR-0594: normalization never rewrites skill files (`@lervo/repository-knowledge` owns the
 * protected roots), and publication admits a change there only from the practice materialization
 * that owns those files.
 */
export {
  NORMALIZATION_PROTECTED_ROOTS,
  normalizationMayRewrite,
} from "@lervo/repository-knowledge";

const PRACTICE_TRAILER = /^Lervo-Practice-Candidate: \S+$/mu;

/** Whether a knowledge commit is the practice materialization that writes skill files. */
export function practiceMaterializationCommit(commit: { body: string }): boolean {
  return PRACTICE_TRAILER.test(commit.body);
}

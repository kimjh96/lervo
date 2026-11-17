import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

/**
 * Reading a settled stage's private CAS artifact (ADR-0585). `input_unavailable` means the object
 * is absent, normally because retention pruned it; it carries no path, hash or body, grants no
 * authority, and the caller treats the settled record as unproven. `invalid` means the bytes are
 * present but differ from their digest or contract. A transient read failure throws instead, so
 * no caller caches it as either state.
 */
export type ConvergenceStageArtifactRead =
  | { state: "available"; value: KnowledgeConvergenceInput }
  | { state: "input_unavailable" }
  | { state: "invalid" };

/** CAS failures that describe the stored object itself, so a retry cannot change the outcome. */
const PERSISTENT_CAS_FAILURES = new Set(["corrupt_object", "invalid_uri", "unsafe_path"]);

export async function readConvergenceStageArtifact(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<ConvergenceStageArtifactRead> {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return { state: "invalid" };
  let bytes: Uint8Array;
  try {
    bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "not_found") return { state: "input_unavailable" };
    if (typeof code === "string" && PERSISTENT_CAS_FAILURES.has(code)) return { state: "invalid" };
    // Anything else, such as EIO, EMFILE or a lock, may succeed later: never record it as a state.
    throw error;
  }
  if (sha256(bytes) !== hash) return { state: "invalid" };
  try {
    return {
      state: "available",
      value: JSON.parse(
        new TextDecoder("utf8", { fatal: true }).decode(bytes),
      ) as KnowledgeConvergenceInput,
    };
  } catch {
    return { state: "invalid" };
  }
}

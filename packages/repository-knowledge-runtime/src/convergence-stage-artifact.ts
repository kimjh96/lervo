import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

/**
 * Reading a settled stage's private CAS artifact (ADR-0585). `input_unavailable` means the object
 * is absent, normally because retention pruned it; it carries no path, hash or body, grants no
 * authority, and the caller treats the settled record as unproven. `invalid` means the bytes are
 * present but differ from their digest or contract.
 */
export type ConvergenceStageArtifactRead =
  | { state: "available"; value: KnowledgeConvergenceInput }
  | { state: "input_unavailable" }
  | { state: "invalid" };

export async function readConvergenceStageArtifact(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<ConvergenceStageArtifactRead> {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return { state: "invalid" };
  let bytes: Uint8Array;
  try {
    bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === "not_found"
      ? { state: "input_unavailable" }
      : { state: "invalid" };
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

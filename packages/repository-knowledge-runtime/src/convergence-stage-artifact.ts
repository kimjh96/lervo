import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

/**
 * One private convergence CAS body. `absent` means the object does not exist, normally because
 * retention pruned it. `invalid` means its bytes differ from their digest or are not JSON, or the
 * store reports a persistent failure. A transient read failure throws instead, so no caller caches
 * it as either state.
 */
type ConvergenceCasJsonRead =
  { state: "available"; value: unknown } | { state: "absent" } | { state: "invalid" };

/** CAS failures that describe the stored object itself, so a retry cannot change the outcome. */
const PERSISTENT_CAS_FAILURES = new Set(["corrupt_object", "invalid_uri", "unsafe_path"]);

async function readConvergenceCasJson(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<ConvergenceCasJsonRead> {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return { state: "invalid" };
  let bytes: Uint8Array;
  try {
    bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // ADR-0658: an object retention pruned is as absent as one never written.
    if (code === "not_found" || code === "pruned") return { state: "absent" };
    if (typeof code === "string" && PERSISTENT_CAS_FAILURES.has(code)) return { state: "invalid" };
    // Anything else, such as EIO, EMFILE or a lock, may succeed later: never record it as a state.
    throw error;
  }
  if (sha256(bytes) !== hash) return { state: "invalid" };
  try {
    return {
      state: "available",
      value: JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as unknown,
    };
  } catch {
    return { state: "invalid" };
  }
}

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
  const read = await readConvergenceCasJson(artifacts, hash);
  if (read.state === "absent") return { state: "input_unavailable" };
  if (read.state === "invalid") return read;
  return { state: "available", value: read.value as KnowledgeConvergenceInput };
}

/**
 * Reading a convergence assignment's own result record: its stage result or failure proof
 * (ADR-0586). `result_unavailable` means the record is absent, normally because retention pruned
 * a superseded stage's record; reports render it as "result unavailable (pruned)". It carries no
 * path, hash or body, grants no authority and is not an integrity failure: the caller proves
 * nothing from the record and reruns or stops the stage. `invalid` keeps its integrity meaning.
 */
export type ConvergenceAssignmentResultRead =
  { state: "available"; value: unknown } | { state: "result_unavailable" } | { state: "invalid" };

export async function readConvergenceAssignmentResult(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<ConvergenceAssignmentResultRead> {
  const read = await readConvergenceCasJson(artifacts, hash);
  return read.state === "absent" ? { state: "result_unavailable" } : read;
}

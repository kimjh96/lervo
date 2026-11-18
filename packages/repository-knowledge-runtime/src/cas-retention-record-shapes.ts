import { sha256 } from "@lervo/repository-knowledge";
import type { CasReferenceFile } from "./cas-retention-files.js";
import type { SupersededLifecycle } from "./cas-retention-superseded.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export type SupersededRecordReason =
  "stage_result_superseded" | "observation_superseded" | "failure_superseded";

/** Facts of one verified body. They never change, because the object is content-addressed. */
export interface ConvergenceRecordShape {
  kind: "stage_result" | "observation" | "failure";
  assignmentId: string;
  /** A stage result's input obligation; an observation's or failure's `inputArtifactHash`. */
  binding: string;
}

/**
 * By bare digest. `null`: the whole body is unknown, unparseable, unverified or too large, so the
 * object stays protected. `no_observation_prefix`: only the first bytes were read and they do not
 * start an observation; a completion that names the object still reads its whole body.
 */
export type ConvergenceRecordShapes = Record<
  string,
  ConvergenceRecordShape | null | "no_observation_prefix"
>;

export function validConvergenceRecordEntry(value: unknown): boolean {
  return value === null || value === "no_observation_prefix" || validConvergenceRecordShape(value);
}

export interface ReleasedRecord {
  reason: SupersededRecordReason;
  assignmentId: string;
}

function validConvergenceRecordShape(value: unknown): value is ConvergenceRecordShape {
  const shape = value as ConvergenceRecordShape | null;
  return (
    shape !== null &&
    typeof shape === "object" &&
    ["stage_result", "observation", "failure"].includes(shape.kind) &&
    typeof shape.assignmentId === "string" &&
    typeof shape.binding === "string"
  );
}

function shaped(
  kind: ConvergenceRecordShape["kind"],
  assignmentId: string,
  binding: unknown,
): ConvergenceRecordShape | null {
  return typeof binding === "string" && HASH.test(binding) ? { kind, assignmentId, binding } : null;
}

/** Classifies a body only when its digest matches and it has every expected field (ADR-0586). */
export function convergenceRecordShape(
  hash: string,
  bytes: Uint8Array,
): ConvergenceRecordShape | null {
  if (sha256(bytes) !== `sha256:${hash}`) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { assignmentId, input } = record;
  if (typeof assignmentId !== "string") return null;
  if (record.kind === "provider_stage_observation" && record.schemaVersion === 1)
    return shaped("observation", assignmentId, record.inputArtifactHash);
  if (
    record.kind === "convergence_assignment_failure" &&
    record.schemaVersion === 1 &&
    typeof record.code === "string"
  )
    return shaped("failure", assignmentId, record.inputArtifactHash);
  if (
    !("kind" in record) &&
    typeof record.state === "string" &&
    typeof record.leaseGeneration === "string" &&
    HASH.test(record.leaseGeneration) &&
    (record.nextStage === null || typeof record.nextStage === "string") &&
    "failureCode" in record &&
    "dependencyHash" in record &&
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof (input as { obligationId?: unknown }).obligationId === "string"
  )
    return {
      kind: "stage_result",
      assignmentId,
      binding: (input as { obligationId: string }).obligationId,
    };
  return null;
}

/**
 * Records that belong only to a superseded stage, past grace. A stage result or failure must be
 * named by its own assignment's completion; an observation must name its assignment and input.
 */
export function releasedConvergenceRecords(
  files: readonly CasReferenceFile[],
  lifecycle: SupersededLifecycle,
  shapes: Readonly<ConvergenceRecordShapes>,
  before: number,
): Map<string, ReleasedRecord> {
  const released = new Map<string, ReleasedRecord>();
  for (const file of files) {
    const entry = file.hash === null ? undefined : shapes[file.hash];
    const shape = typeof entry === "object" ? entry : null;
    if (
      shape === null ||
      file.modifiedAt >= before ||
      (lifecycle.namedAt.get(file.hash!) ?? 0) >= before
    )
      continue;
    const owner =
      shape.kind === "observation" ? shape.assignmentId : lifecycle.completions.get(file.hash!);
    const assignment = owner === undefined ? undefined : lifecycle.assignments.get(owner);
    if (assignment === undefined || shape.assignmentId !== owner) continue;
    const reason: SupersededRecordReason | null =
      shape.kind === "stage_result"
        ? shape.binding === assignment.obligationId
          ? "stage_result_superseded"
          : null
        : shape.binding !== `sha256:${assignment.input}`
          ? null
          : shape.kind === "failure"
            ? "failure_superseded"
            : "observation_superseded";
    if (reason !== null) released.set(file.hash!, { reason, assignmentId: owner! });
  }
  return released;
}

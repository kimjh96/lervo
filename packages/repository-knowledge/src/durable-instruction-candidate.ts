import type { GroundedDurableInstruction, DurableInstructionPlan } from "./durable-instruction.js";
import { sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

/** Where an owner rule entered intake: the explicit command, a terminal prompt, or a conversation. */
export type DurableInstructionCaptureSource =
  "explicit_intake" | "terminal_prompt" | "conversation";

export interface DurableInstructionCandidate {
  schemaVersion: 1;
  candidateId: string;
  projectId: string;
  provider: "codex" | "claude";
  sourceSnapshotId: string;
  requestDigest: string;
  resolverResultDigest: string;
  planId: string;
  ruleId: string;
  targetPath: string;
  proposedContentHash: string;
  proposedMarkdown: string;
  instruction: GroundedDurableInstruction;
  reasonIds: string[];
  createdAt: string;
  /** Instruction-catalog digest at creation; review binds to it instead of the whole snapshot. */
  instructionCatalogDigest?: string;
  captureSource?: DurableInstructionCaptureSource;
  /** The ADR-0467 capture record that produced this candidate, when it was captured. */
  captureId?: string;
}

export interface DurableInstructionCandidateInspection extends DurableInstructionCandidate {
  candidateHash: string;
  artifactPath: string;
}

export const durableInstructionCandidateId = /^kinstruction_[a-f0-9]{24}$/u;
export const maximumDurableInstructionCandidateBytes = 16 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SNAPSHOT_ID = /^ksnap_[a-f0-9]{24}$/u;
const RULE_ID = /^rule_[a-f0-9]{24}$/u;
const PLAN_ID = /^kinstructionplan_[a-f0-9]{24}$/u;
const REASON_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;

const CAPTURE_ID = /^kcap_[a-f0-9]{24}$/u;
const optionalCandidateKeys = ["instructionCatalogDigest", "captureSource", "captureId"] as const;

function exactKeys(
  value: object,
  expected: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    expected.every((key) => keys.includes(key)) &&
    keys.every((key) => expected.includes(key) || optional.includes(key))
  );
}

function validOptionalCandidateFields(candidate: DurableInstructionCandidate): boolean {
  return (
    (candidate.instructionCatalogDigest === undefined ||
      HASH.test(candidate.instructionCatalogDigest)) &&
    (candidate.captureSource === undefined ||
      ["explicit_intake", "terminal_prompt", "conversation"].includes(candidate.captureSource)) &&
    (candidate.captureId === undefined ||
      (typeof candidate.captureId === "string" &&
        CAPTURE_ID.test(candidate.captureId) &&
        candidate.captureSource !== undefined &&
        candidate.captureSource !== "explicit_intake"))
  );
}

function safeScopePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function validInstruction(value: unknown): value is GroundedDurableInstruction {
  const item = value as GroundedDurableInstruction | null;
  return (
    item !== null &&
    typeof item === "object" &&
    exactKeys(item, [
      "disposition",
      "speechAct",
      "authority",
      "durability",
      "operation",
      "scope",
      "title",
      "statement",
      "exceptions",
      "risk",
      "conflict",
      "confidence",
      "reasonIds",
    ]) &&
    item.disposition === "canonical" &&
    item.speechAct === "directive" &&
    item.authority === "explicit_user" &&
    item.durability === "repository" &&
    item.operation === "add" &&
    (item.scope.kind === "repository" || item.scope.kind === "paths") &&
    exactKeys(item.scope, ["kind", "paths"]) &&
    Array.isArray(item.scope.paths) &&
    item.scope.paths.length <= 16 &&
    item.scope.paths.every(safeScopePath) &&
    new Set(item.scope.paths).size === item.scope.paths.length &&
    (item.scope.kind === "paths") === item.scope.paths.length > 0 &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    Buffer.byteLength(item.title) <= 160 &&
    typeof item.statement === "string" &&
    item.statement.length > 0 &&
    Buffer.byteLength(item.statement) <= 2_000 &&
    Array.isArray(item.exceptions) &&
    item.exceptions.length <= 16 &&
    item.exceptions.every(
      (entry) => typeof entry === "string" && entry.length > 0 && Buffer.byteLength(entry) <= 512,
    ) &&
    item.risk === "low" &&
    item.conflict === "none" &&
    item.confidence === "high" &&
    Array.isArray(item.reasonIds) &&
    item.reasonIds.length <= 8 &&
    item.reasonIds.every((entry) => typeof entry === "string" && REASON_ID.test(entry)) &&
    new Set(item.reasonIds).size === item.reasonIds.length
  );
}

export function validateDurableInstructionCandidate(value: unknown): DurableInstructionCandidate {
  const candidate = value as DurableInstructionCandidate | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    !exactKeys(
      candidate,
      [
        "schemaVersion",
        "candidateId",
        "projectId",
        "provider",
        "sourceSnapshotId",
        "requestDigest",
        "resolverResultDigest",
        "planId",
        "ruleId",
        "targetPath",
        "proposedContentHash",
        "proposedMarkdown",
        "instruction",
        "reasonIds",
        "createdAt",
      ],
      optionalCandidateKeys,
    ) ||
    !validOptionalCandidateFields(candidate) ||
    candidate.schemaVersion !== 1 ||
    !durableInstructionCandidateId.test(candidate.candidateId) ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(candidate.projectId) ||
    !["codex", "claude"].includes(candidate.provider) ||
    !SNAPSHOT_ID.test(candidate.sourceSnapshotId) ||
    !HASH.test(candidate.requestDigest) ||
    !HASH.test(candidate.resolverResultDigest) ||
    !PLAN_ID.test(candidate.planId) ||
    !RULE_ID.test(candidate.ruleId) ||
    candidate.targetPath !== `docs/instructions/generated/${candidate.ruleId}.md` ||
    !HASH.test(candidate.proposedContentHash) ||
    typeof candidate.proposedMarkdown !== "string" ||
    Buffer.byteLength(candidate.proposedMarkdown) > 8 * 1024 ||
    sha256(candidate.proposedMarkdown) !== candidate.proposedContentHash ||
    !validInstruction(candidate.instruction) ||
    !Array.isArray(candidate.reasonIds) ||
    candidate.reasonIds.length > 8 ||
    candidate.reasonIds.some((item) => typeof item !== "string" || !REASON_ID.test(item)) ||
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    new Date(candidate.createdAt).toISOString() !== candidate.createdAt ||
    stableId("kinstruction", {
      projectId: candidate.projectId,
      sourceSnapshotId: candidate.sourceSnapshotId,
      planId: candidate.planId,
      proposedContentHash: candidate.proposedContentHash,
    }) !== candidate.candidateId
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The durable-instruction candidate record is invalid.",
    );
  return candidate;
}

export function createDurableInstructionCandidate(input: {
  plan: DurableInstructionPlan;
  provider: "codex" | "claude";
  sourceSnapshotId: string;
  instruction: GroundedDurableInstruction;
  now: Date;
  instructionCatalogDigest?: string;
  capture?: { source: "terminal_prompt" | "conversation"; captureId: string };
}): DurableInstructionCandidate {
  const operation = input.plan.operations[0];
  if (
    input.plan.status !== "ready" ||
    input.plan.ruleId === null ||
    input.plan.targetPath === null ||
    input.plan.operations.length !== 1 ||
    operation?.action !== "create" ||
    operation.content === undefined ||
    !validInstruction(input.instruction) ||
    !SNAPSHOT_ID.test(input.sourceSnapshotId)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Only an eligible durable-instruction plan can become a review candidate.",
    );
  const candidateId = stableId("kinstruction", {
    projectId: input.plan.projectId,
    sourceSnapshotId: input.sourceSnapshotId,
    planId: input.plan.planId,
    proposedContentHash: operation.desiredHash,
  });
  return {
    schemaVersion: 1,
    candidateId,
    projectId: input.plan.projectId,
    provider: input.provider,
    sourceSnapshotId: input.sourceSnapshotId,
    requestDigest: input.plan.requestDigest,
    resolverResultDigest: input.plan.resolverResultDigest,
    planId: input.plan.planId,
    ruleId: input.plan.ruleId,
    targetPath: input.plan.targetPath,
    proposedContentHash: operation.desiredHash,
    proposedMarkdown: operation.content,
    instruction: input.instruction,
    reasonIds: [...input.plan.reasonIds],
    createdAt: input.now.toISOString(),
    ...(input.instructionCatalogDigest === undefined
      ? {}
      : { instructionCatalogDigest: input.instructionCatalogDigest }),
    ...(input.capture === undefined
      ? {}
      : { captureSource: input.capture.source, captureId: input.capture.captureId }),
  };
}

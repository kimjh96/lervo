import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { validateSchema, type VerificationResult } from "@lervo/schemas";
import {
  MAX_RESEARCH_INPUT_BYTES,
  researchContractHash,
  verifyResearchBrief,
  type ResearchInputsV1,
} from "@lervo/roles";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";

/** Reconstructs deterministic research evidence from the producer's actual run and exact CAS originals. */
export async function readSupervisionResearchEvidence(input: {
  storage: ProjectStorage;
  responsibility: WorkResponsibilityV1;
  terminalEventId: string;
}) {
  const { storage, responsibility: task } = input;
  const terminal = storage.events.get(input.terminalEventId);
  if (terminal?.type !== "run.completed" || terminal.payload.verificationStatus !== "passed")
    throw new Error("Research evaluation requires a completed verified producer run.");
  const events = collectRunEventsBounded({
    events: storage.events,
    runId: terminal.runId,
    maximumEvents: 4096,
  });
  const bindings = events.filter((event) => event.type === "role.input.bound");
  const verifications = events.filter(
    (event) =>
      event.type === "verification.completed" && event.payload.suiteId === "role.research.artifact",
  );
  const bound = bindings[0];
  const verified = verifications[0];
  const started = events.find((event) => event.type === "adapter.started");
  if (
    bindings.length !== 1 ||
    verifications.length !== 1 ||
    bound === undefined ||
    verified === undefined ||
    bound.schemaVersion !== 3 ||
    bound.actor.kind !== "system" ||
    bound.payload.schemaVersion !== 1 ||
    bound.payload.roleId !== task.roleId ||
    bound.payload.roleContractHash !== task.roleContractHash ||
    bound.payload.inputContractId !== "research.inputs.v1" ||
    typeof bound.payload.inputArtifactHash !== "string" ||
    started === undefined ||
    bound.seq >= started.seq ||
    verified.seq <= started.seq ||
    verified.seq >= terminal.seq ||
    verified.actor.kind !== "system" ||
    verified.payload.status !== "passed" ||
    typeof verified.payload.resultContentHash !== "string" ||
    typeof terminal.payload.resultDigest !== "string"
  )
    throw new Error(
      "The research input or verification is not bound to the producer's ordered run.",
    );
  const inputs = (await readSupervisionJsonArtifact(
    storage.artifacts,
    bound.payload.inputArtifactHash,
  )) as ResearchInputsV1;
  const result = (await readSupervisionJsonArtifact(
    storage.artifacts,
    verified.payload.resultContentHash,
  )) as VerificationResult;
  if (
    !validateSchema("verificationResult", result).valid ||
    result.status !== "passed" ||
    result.suiteId !== "role.research.artifact" ||
    result.suiteHash !== verified.payload.suiteHash ||
    result.verificationId !== verified.payload.verificationId ||
    result.repositoryRevision !== verified.payload.repositoryRevision ||
    result.completedAt !== verified.occurredAt ||
    result.commands.length !== 1 ||
    inputs.roleContractHash !== task.roleContractHash ||
    inputs.policy.projectId !== storage.manifest.projectId ||
    inputs.researchQuestion !== task.taskPurpose ||
    inputs.policy.allowedPaths.some(
      (path) => !task.expectedPaths.some((root) => path === root || path.startsWith(`${root}/`)),
    )
  )
    throw new Error("The research input and verification source differ from the exact task.");
  const command = result.commands[0]!;
  if (
    command.commandId !== "research-artifact" ||
    command.status !== "passed" ||
    command.exitCode !== 0 ||
    command.stdoutArtifact === null
  )
    throw new Error("The research checker has no successful original output.");
  const content = await readSupervisionTextArtifact(
    storage.artifacts,
    terminal.payload.resultDigest,
  );
  const {
    body: _body,
    manifest: _manifest,
    ...report
  } = verifyResearchBrief({ content, inputs, now: result.completedAt });
  const originalReport = await readSupervisionJsonArtifact(
    storage.artifacts,
    command.stdoutArtifact.contentHash,
  );
  if (
    researchContractHash(originalReport) !== researchContractHash(report) ||
    report.inputHash !== bound.payload.inputArtifactHash ||
    Buffer.byteLength(JSON.stringify(inputs)) > MAX_RESEARCH_INPUT_BYTES
  )
    throw new Error(
      "The research checker output differs from recomputed schema and source traceability.",
    );
  return {
    assignmentId: task.assignmentId,
    producerRunId: terminal.runId,
    inputEventId: bound.eventId,
    inputArtifactHash: bound.payload.inputArtifactHash,
    inputs,
    resultContentHash: terminal.payload.resultDigest,
    verificationEventId: verified.eventId,
    verificationArtifactHash: verified.payload.resultContentHash,
    reportArtifactHash: command.stdoutArtifact.contentHash,
    verifiedAt: result.completedAt,
  };
}

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createFileFirstPublicationStageApprovalStore } from "../../lib/file-first-publication-stage-approval-store.mjs";
import {
  createFirstPublicationStageApprovalAttempt,
  createFirstPublicationStageApprovalReceipt,
  createFirstPublicationStageApprovalTerminal,
} from "../../lib/first-publication-stage-approval-records.mjs";
import { createFirstPublicationStageApprovalFixture } from "./first-publication-stage-approval.mjs";

export function matchingPublicReleaseObservation(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "npm_public_registry_reconciliation",
    state: "observed",
    package: fixture.stageReviewReport.target.package,
    version: fixture.stageReviewReport.target.version,
    distTag: fixture.stageReviewReport.npm.stage.distTag,
    versionMetadata: {
      state: "found",
      registryIntegrity: fixture.authorization.binding.artifact.registryIntegrity,
      registryShasum: fixture.authorization.binding.artifact.registryShasum,
    },
    distTagValue: {
      state: "found",
      version: fixture.stageReviewReport.target.version,
    },
    ...overrides,
  };
}

export function matchingStageApprovalReconciliationObservation(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "npm_stage_approval_reconciliation",
    state: "observed",
    registry: fixture.authorization.binding.registry,
    package: fixture.stageReviewReport.target.package,
    version: fixture.stageReviewReport.target.version,
    distTag: fixture.authorization.binding.distTag,
    publicRelease: matchingPublicReleaseObservation(fixture),
    stage: { state: "absent" },
    stageListStability: "rechecked_unchanged",
    userConfig: "rechecked_unchanged",
    temporaryFiles: "removed",
    ...overrides,
  };
}

export async function createFirstPublicationStageApprovalReconciliationFixture({
  terminalState = "approval_command_completed",
} = {}) {
  const value = await createFirstPublicationStageApprovalFixture();
  const decisionPath = resolve(value.root, "decision.json");
  const authorizationPath = resolve(value.root, "authorization.json");
  const resultDirectory = resolve(value.root, "approval-result");
  await writeFile(decisionPath, `${JSON.stringify(value.decision, null, 2)}\n`);
  await writeFile(authorizationPath, `${JSON.stringify(value.authorization, null, 2)}\n`);
  const attempt = createFirstPublicationStageApprovalAttempt({
    authorization: value.authorization,
    reservedAt: "2026-08-21T10:17:00Z",
  });
  const terminal = createFirstPublicationStageApprovalTerminal({
    attempt,
    state: terminalState,
    completedAt: "2026-08-21T10:18:00Z",
    ...(terminalState === "approval_command_completed"
      ? { receipt: createFirstPublicationStageApprovalReceipt(attempt) }
      : {}),
  });
  const store = createFileFirstPublicationStageApprovalStore({ rootDirectory: resultDirectory });
  await store.reserve(attempt);
  await (terminalState === "approval_command_completed"
    ? store.complete(terminal)
    : store.markUnknown(terminal));
  return {
    ...value,
    decisionPath,
    authorizationPath,
    resultDirectory,
    attempt,
    terminal,
  };
}

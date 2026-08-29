import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { LocalLinkedEvidenceShadowStore } from "../../packages/search-local/dist/index.js";
import { openProjectStorage } from "../../packages/project-storage/dist/index.js";

import { assessPhaseAPilotOutcome } from "./linked-evidence-shadow-phase-a-pilot-eligibility.mjs";
import { loadPreparedPhaseAPilot } from "./linked-evidence-shadow-phase-a-pilot-workspace.mjs";

async function ownerJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function existingReceipts(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, receipts: [] };
    throw error;
  }
}

async function hasCompletedRun(repositoryRoot, runId) {
  if (typeof runId !== "string") return false;
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return storage.events
      .list({ runId, limit: 1000 })
      .some((event) => event.type === "run.completed");
  } finally {
    await storage.close();
  }
}

export async function executePhaseAPilot(
  repositoryRoot,
  contractPath,
  onProgress = () => undefined,
) {
  const prepared = await loadPreparedPhaseAPilot(repositoryRoot, contractPath);
  const receiptSet = await existingReceipts(prepared.paths.receipts);
  if (receiptSet.receipts.length > 0) {
    throw new Error(
      "The phase-A pilot execution already started; existing receipts were preserved.",
    );
  }
  const store = await LocalLinkedEvidenceShadowStore.open(prepared.paths.repository);
  if ((await store.list()).length !== 0) {
    throw new Error("The phase-A pilot observation store was not empty before execution.");
  }
  const cliEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");
  for (const runSpec of prepared.manifest.schedule) {
    onProgress({ phase: "run_started", ordinal: runSpec.ordinal, caseId: runSpec.caseId });
    const result = spawnSync(
      process.execPath,
      [
        cliEntry,
        "run",
        "--provider",
        prepared.loaded.contract.provider,
        "--role",
        prepared.loaded.contract.managedRun.roleId,
        "--path",
        runSpec.targetPath,
        "--verification",
        runSpec.verificationSuiteId,
        "--risk",
        prepared.loaded.contract.managedRun.risk,
        "--root",
        prepared.paths.repository,
        "--json",
        runSpec.query,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    let outcome;
    try {
      outcome = JSON.parse(result.stdout);
    } catch {
      outcome = null;
    }
    const runCompleted = await hasCompletedRun(prepared.paths.repository, outcome?.runId);
    const assessment = assessPhaseAPilotOutcome({
      contract: prepared.loaded.contract,
      runSpec,
      exitStatus: result.status,
      outcome,
      runCompleted,
    });
    if (!assessment.eligible) {
      await ownerJson(resolve(prepared.paths.controller, "failure.json"), {
        schemaVersion: 1,
        status: "stopped",
        ordinal: runSpec.ordinal,
        caseId: runSpec.caseId,
        failureReason: assessment.reason,
        exitStatus: result.status,
        signal: result.signal,
        timedOut: result.error?.code === "ETIMEDOUT",
        runId: outcome?.runId ?? null,
        primaryRunCompleted: runCompleted,
        verificationStatus: outcome?.verificationStatus ?? null,
        writingPublicationStatus: outcome?.writingPublication?.status ?? null,
        writingSemanticEvaluationStatus:
          outcome?.writingPublication?.semanticEvaluationStatus ?? null,
        writingFailedChecks: outcome?.writingPublication?.failedChecks ?? [],
        writingMissingChecks: outcome?.writingPublication?.missingChecks ?? [],
        writingEvaluationArtifactId:
          outcome?.writingPublication?.evaluationArtifact?.artifactId ?? null,
        stderrTail: String(result.stderr).slice(-4000),
      });
      throw new Error(
        `Phase-A provider run ${runSpec.ordinal} is ineligible: ${assessment.reason}.`,
      );
    }
    const observations = await store.list();
    const observation = observations.find((item) => item.runId === outcome.runId);
    if (observations.length !== runSpec.ordinal || observation?.status !== "observed") {
      throw new Error(`Phase-A shadow observation ${runSpec.ordinal} is missing or unavailable.`);
    }
    receiptSet.receipts.push({
      ordinal: runSpec.ordinal,
      caseId: runSpec.caseId,
      repetition: runSpec.repetition,
      runId: outcome.runId,
      targetPath: runSpec.targetPath,
      verificationSuiteId: runSpec.verificationSuiteId,
      observationRecordId: observation.recordId,
      cliExitStatus: result.status,
      primaryRunCompleted: runCompleted,
      writingPublicationStatus: outcome.writingPublication.status,
      writingSemanticEvaluationStatus: outcome.writingPublication.semanticEvaluationStatus,
      writingEvaluationArtifactId: outcome.writingPublication.evaluationArtifact.artifactId,
      providerInvocationCount: assessment.providerInvocationCount,
    });
    await ownerJson(prepared.paths.receipts, receiptSet);
    onProgress({
      phase: "run_completed",
      ordinal: runSpec.ordinal,
      runId: outcome.runId,
      retainedCount: observation.retainedCount,
      truncated: observation.truncated,
    });
  }
  return receiptSet;
}

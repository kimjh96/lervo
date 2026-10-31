import { canonicalJson } from "@lervo/event-contract";
import { loadProjectManifest } from "./config.js";
import { inspectEventWriterCoordinate } from "./event-writer-coordinate-store.js";
import { ensureEventWriterDataDirectory } from "./event-writer-activation-transaction-io.js";
import { contentHash } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import {
  createReportStorageCoordinate,
  readReportStorageEvidence,
  ReportStorageError,
  type ReportStorageCoordinate,
  type ReportStorageEvidence,
} from "./report-storage-contract.js";
import {
  assertReportStorageIdle,
  finishReportStoragePublication,
  publishReportStorageSelection,
  readReportStorageFile,
  reportStoragePaths,
} from "./report-storage-files.js";

export { ReportStorageError } from "./report-storage-contract.js";
export type {
  ReportStorageCoordinate,
  ReportStorageEvidence,
  ReportStorageReader,
} from "./report-storage-contract.js";
export interface ReportStorageActivationPlan {
  schemaVersion: 1;
  planId: string;
  repositoryRoot: string;
  projectId: string;
  status: "ready" | "current";
  coordinate: ReportStorageCoordinate;
  desiredContent: string;
  desiredContentHash: string;
}
export async function inspectReportStorageCoordinate(repositoryRoot: string) {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  await assertReportStorageIdle(paths.data);
  const current = await readReportStorageFile(
    reportStoragePaths(paths.data).current,
    manifest.projectId,
  );
  return {
    projectId: manifest.projectId,
    coordinate: current?.coordinate ?? null,
    contentHash: current?.contentHash ?? null,
  };
}
function assertFresh(evidence: ReportStorageEvidence) {
  const age = Date.now() - Date.parse(evidence.observedAt);
  if (age < -30_000 || age > 300_000)
    throw new ReportStorageError(
      "report_storage_stale",
      "Report reader evidence must be a current observation.",
    );
}
export async function planReportStorageActivation(input: {
  repositoryRoot: string;
  evidence: unknown;
}): Promise<ReportStorageActivationPlan> {
  const paths = resolveProjectPaths(input.repositoryRoot);
  const evidence = readReportStorageEvidence(input.evidence);
  assertFresh(evidence);
  const writer = await inspectEventWriterCoordinate(paths.repositoryRoot);
  if (
    writer.projectId !== evidence.projectId ||
    writer.contentHash !== evidence.writerCoordinateHash ||
    (writer.coordinate.selectedEventSchemaVersion !== 6 &&
      writer.coordinate.selectedEventSchemaVersion !== 7)
  )
    throw new ReportStorageError(
      "report_storage_stale",
      "Report activation requires the current version-6 writer coordinate.",
    );
  const expected = writer.coordinate.activationEvidence.readers.map(
    ({ readerId, peerIdentityHash }) => ({ readerId, peerIdentityHash }),
  );
  const actual = evidence.readers.map(({ readerId, peerIdentityHash }) => ({
    readerId,
    peerIdentityHash,
  }));
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new ReportStorageError(
      "report_storage_invalid",
      "Report reader evidence must cover the selected writer inventory exactly.",
    );
  const selected = await inspectReportStorageCoordinate(paths.repositoryRoot);
  const coordinate = createReportStorageCoordinate(evidence);
  const desiredContent = `${JSON.stringify(coordinate, null, 2)}\n`;
  if (selected.coordinate && canonicalJson(selected.coordinate) !== canonicalJson(coordinate))
    throw new ReportStorageError(
      "report_storage_stale",
      "An existing report storage selection cannot be replaced.",
    );
  const desiredContentHash = contentHash(desiredContent);
  return {
    schemaVersion: 1,
    planId: `rsplan_${contentHash(canonicalJson({ repositoryRoot: paths.repositoryRoot, desiredContentHash })).slice(7, 31)}`,
    repositoryRoot: paths.repositoryRoot,
    projectId: evidence.projectId,
    status: selected.coordinate ? "current" : "ready",
    coordinate,
    desiredContent,
    desiredContentHash,
  };
}

export async function applyReportStorageActivation(input: {
  plan: ReportStorageActivationPlan;
  approval: string;
  currentEvidence: unknown;
  failureInjector?: (phase: "staged" | "published") => void | Promise<void>;
}) {
  const plan = structuredClone(input.plan);
  if (input.approval !== plan.planId || plan.status !== "ready")
    throw new ReportStorageError(
      "report_storage_stale",
      "Approval must name a ready report storage activation plan.",
    );
  const currentEvidence = readReportStorageEvidence(input.currentEvidence);
  assertFresh(currentEvidence);
  const { observedAt: _currentTime, ...observed } = currentEvidence;
  const { observedAt: _plannedTime, ...planned } = plan.coordinate.evidence;
  if (canonicalJson(observed) !== canonicalJson(planned))
    throw new ReportStorageError(
      "report_storage_stale",
      "Report reader evidence changed after planning.",
    );
  const current = await planReportStorageActivation({
    repositoryRoot: plan.repositoryRoot,
    evidence: plan.coordinate.evidence,
  });
  if (canonicalJson(current) !== canonicalJson(plan))
    throw new ReportStorageError(
      "report_storage_stale",
      "Report activation inputs changed after planning.",
    );
  const paths = resolveProjectPaths(plan.repositoryRoot);
  await ensureEventWriterDataDirectory(paths.data);
  await publishReportStorageSelection({
    data: paths.data,
    projectId: plan.projectId,
    content: plan.desiredContent,
    ...(input.failureInjector ? { checkpoint: input.failureInjector } : {}),
  });
  return {
    planId: plan.planId,
    coordinateHash: plan.desiredContentHash,
    activationId: plan.coordinate.activationId,
  };
}

/** Complete the already approved immutable publication; never downgrade the database or replace bytes. */
export async function recoverReportStorageActivation(repositoryRoot: string): Promise<void> {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  await finishReportStoragePublication(paths.data, manifest.projectId);
}

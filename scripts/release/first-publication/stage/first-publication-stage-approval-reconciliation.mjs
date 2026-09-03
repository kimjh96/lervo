import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  bindFirstPublicationStageApprovalTerminal,
  validateFirstPublicationStageApprovalAttempt,
} from "./first-publication-stage-approval-records.mjs";
import { inspectFirstPublicationPublicRelease } from "../shared/first-publication-public-release-policy.mjs";
import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail(code = "first_publication_stage_approval_reconciliation_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI npm stage approval reconciliation evidence is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !timestampPattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail();
  return Date.parse(value);
}

function stageCheck(stage) {
  if (stage?.state === "absent" && exactKeys(stage, ["state"])) {
    return { id: "approval_stage_absent", status: "matched", reasons: [] };
  }
  if (stage?.state === "present" && exactKeys(stage, ["state"])) {
    return {
      id: "approval_stage_absent",
      status: "not_observed",
      reasons: ["approval_stage_still_present"],
    };
  }
  if (["ambiguous", "replacement_observed"].includes(stage?.state) && exactKeys(stage, ["state"])) {
    return {
      id: "approval_stage_absent",
      status: "unknown",
      reasons: ["stage_set_inconsistent"],
    };
  }
  fail();
}

function publicTarget(attempt) {
  return {
    registry: attempt.stage.registry,
    package: attempt.target.package,
    version: attempt.target.version,
    distTag: attempt.stage.distTag,
    access: "public",
  };
}

function outcome(publicRelease, stage) {
  if (publicRelease.outcome === "published" && stage.status === "matched") {
    return "public_release_confirmed";
  }
  if (publicRelease.outcome === "not_observed" && stage.status === "not_observed") {
    return "approval_not_confirmed";
  }
  return "unknown";
}

export function createFirstPublicationStageApprovalReconciliationReport({
  stageReviewReport,
  authorization,
  attempt,
  terminal,
  observation,
  observedAt,
}) {
  validateFirstPublicationStageApprovalAttempt(attempt);
  bindFirstPublicationStageApprovalTerminal(terminal, attempt);
  if (
    !["approval_command_completed", "approval_outcome_unknown"].includes(terminal.state) ||
    authorization?.authorizationDigest !== attempt.authorizationDigest ||
    stageReviewReport?.evidenceDigest !== authorization?.binding?.stageReviewEvidenceDigest ||
    observation?.schemaVersion !== 1 ||
    observation.source !== "npm_stage_approval_reconciliation" ||
    observation.state !== "observed" ||
    observation.registry !== attempt.stage.registry ||
    observation.package !== attempt.target.package ||
    observation.version !== attempt.target.version ||
    observation.distTag !== attempt.stage.distTag ||
    observation.stageListStability !== "rechecked_unchanged" ||
    observation.userConfig !== "rechecked_unchanged" ||
    observation.temporaryFiles !== "removed" ||
    timestamp(observedAt) < timestamp(terminal.completedAt)
  )
    fail();
  let release;
  try {
    release = inspectFirstPublicationPublicRelease({
      observation: observation.publicRelease,
      target: publicTarget(attempt),
      artifact: attempt.artifact,
    });
  } catch {
    fail();
  }
  const approvalStage = stageCheck(observation.stage);
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    evidenceType: "first_publication_npm_stage_approval_reconciliation",
    outcome: outcome(release, approvalStage),
    target: structuredClone(attempt.target),
    binding: {
      stageReviewEvidenceDigest: stageReviewReport.evidenceDigest,
      authorizationDigest: authorization.authorizationDigest,
      attemptDigest: attempt.attemptDigest,
      terminalDigest: terminal.terminalDigest,
      terminalState: terminal.state,
      stage: structuredClone(attempt.stage),
      artifact: structuredClone(attempt.artifact),
    },
    npm: {
      observedAt,
      registry: attempt.stage.registry,
      publicRelease: structuredClone(observation.publicRelease),
      approvalStage: structuredClone(observation.stage),
      stageListStability: observation.stageListStability,
      userConfig: observation.userConfig,
      temporaryFiles: observation.temporaryFiles,
    },
    checks: [...release.checks, approvalStage],
    limitations: {
      upstreamEvidenceAuthenticity: "not_verified",
      privatePackageState: "not_observed",
      registryStateAfterObservation: "not_verified",
      automaticRetryAuthority: "not_granted",
      transitionCompletion: "not_granted",
    },
    sideEffects: {
      attempt: "unchanged",
      terminal: "unchanged",
      npmSettings: "observed_not_changed",
      stageList: "performed_read_only",
      stageApprove: "not_attempted",
      stageReject: "not_attempted",
      publication: "not_attempted",
      temporaryFiles: "removed",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageApprovalReconciliationReport(report, evidence) {
  const expected = createFirstPublicationStageApprovalReconciliationReport(evidence);
  if (canonicalJson(report) !== canonicalJson(expected)) fail();
  return report;
}

export function validateFirstPublicationStageApprovalReconciliationReportDocument(report) {
  const body = structuredClone(report ?? {});
  delete body.evidenceDigest;
  const binding = report?.binding;
  const npm = report?.npm;
  if (
    !exactKeys(report, [
      "schemaVersion",
      "status",
      "evidenceType",
      "outcome",
      "target",
      "binding",
      "npm",
      "checks",
      "limitations",
      "sideEffects",
      "evidenceDigest",
    ]) ||
    report.schemaVersion !== 1 ||
    report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_npm_stage_approval_reconciliation" ||
    !["public_release_confirmed", "approval_not_confirmed", "unknown"].includes(report.outcome) ||
    !exactKeys(binding, [
      "stageReviewEvidenceDigest",
      "authorizationDigest",
      "attemptDigest",
      "terminalDigest",
      "terminalState",
      "stage",
      "artifact",
    ]) ||
    [
      binding.stageReviewEvidenceDigest,
      binding.authorizationDigest,
      binding.attemptDigest,
      binding.terminalDigest,
    ].some((value) => !digestPattern.test(value ?? "")) ||
    !["approval_command_completed", "approval_outcome_unknown"].includes(binding.terminalState) ||
    !exactKeys(binding.stage, ["registry", "idDigest", "distTag"]) ||
    binding.stage.registry !== "https://registry.npmjs.org/" ||
    !digestPattern.test(binding.stage.idDigest ?? "") ||
    !["latest", "next"].includes(binding.stage.distTag) ||
    !exactKeys(binding.artifact, ["byteCount", "sha256", "registryIntegrity", "registryShasum"]) ||
    !Number.isSafeInteger(binding.artifact.byteCount) ||
    binding.artifact.byteCount <= 0 ||
    !/^[a-f0-9]{64}$/u.test(binding.artifact.sha256 ?? "") ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(binding.artifact.registryIntegrity ?? "") ||
    !/^[a-f0-9]{40}$/u.test(binding.artifact.registryShasum ?? "") ||
    !exactKeys(report.target, [
      "repository",
      "sourceCommit",
      "releaseTag",
      "package",
      "version",
      "workflowPath",
      "runId",
      "attempt",
    ]) ||
    report.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(report.target.version ?? "") ||
    report.target.releaseTag !== `v${report.target.version}` ||
    !exactKeys(npm, [
      "observedAt",
      "registry",
      "publicRelease",
      "approvalStage",
      "stageListStability",
      "userConfig",
      "temporaryFiles",
    ]) ||
    timestamp(npm.observedAt) < 0 ||
    npm.registry !== "https://registry.npmjs.org/" ||
    npm.stageListStability !== "rechecked_unchanged" ||
    npm.userConfig !== "rechecked_unchanged" ||
    npm.temporaryFiles !== "removed" ||
    !digestPattern.test(report.evidenceDigest ?? "") ||
    report.evidenceDigest !== canonicalDigest(body)
  )
    fail("first_publication_stage_approval_reconciliation_report_invalid");
  let release;
  let approvalStage;
  try {
    release = inspectFirstPublicationPublicRelease({
      observation: npm.publicRelease,
      target: {
        registry: binding.stage.registry,
        package: report.target.package,
        version: report.target.version,
        distTag: binding.stage.distTag,
        access: "public",
      },
      artifact: binding.artifact,
    });
    approvalStage = stageCheck(npm.approvalStage);
  } catch {
    fail("first_publication_stage_approval_reconciliation_report_invalid");
  }
  const limitations = {
    upstreamEvidenceAuthenticity: "not_verified",
    privatePackageState: "not_observed",
    registryStateAfterObservation: "not_verified",
    automaticRetryAuthority: "not_granted",
    transitionCompletion: "not_granted",
  };
  const sideEffects = {
    attempt: "unchanged",
    terminal: "unchanged",
    npmSettings: "observed_not_changed",
    stageList: "performed_read_only",
    stageApprove: "not_attempted",
    stageReject: "not_attempted",
    publication: "not_attempted",
    temporaryFiles: "removed",
  };
  if (
    canonicalJson(report.checks) !== canonicalJson([...release.checks, approvalStage]) ||
    report.outcome !== outcome(release, approvalStage) ||
    canonicalJson(report.limitations) !== canonicalJson(limitations) ||
    canonicalJson(report.sideEffects) !== canonicalJson(sideEffects)
  )
    fail("first_publication_stage_approval_reconciliation_report_invalid");
  return report;
}

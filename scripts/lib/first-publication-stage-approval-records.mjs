import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;

function fail(code = "first_publication_stage_approval_record_invalid") {
  throw new FirstPublicationBootstrapError(code, "The CLI npm stage approval record is invalid.");
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
  return (
    typeof value === "string" && timestampPattern.test(value) && Number.isFinite(Date.parse(value))
  );
}

function withoutDigest(value, name) {
  const body = structuredClone(value);
  delete body[name];
  return body;
}

function validateCoordinates(target, stage, artifact) {
  if (
    !exactKeys(target, [
      "repository",
      "sourceCommit",
      "releaseTag",
      "package",
      "version",
      "workflowPath",
      "runId",
      "attempt",
    ]) ||
    target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(target.version ?? "") ||
    target.releaseTag !== `v${target.version}` ||
    !exactKeys(stage, ["registry", "idDigest", "distTag"]) ||
    stage.registry !== "https://registry.npmjs.org/" ||
    !digestPattern.test(stage.idDigest ?? "") ||
    !["latest", "next"].includes(stage.distTag) ||
    !exactKeys(artifact, ["byteCount", "sha256", "registryIntegrity", "registryShasum"]) ||
    !Number.isSafeInteger(artifact.byteCount) ||
    artifact.byteCount <= 0 ||
    artifact.byteCount > 64 * 1024 * 1024 ||
    !sha256Pattern.test(artifact.sha256 ?? "") ||
    !integrityPattern.test(artifact.registryIntegrity ?? "") ||
    !sha1Pattern.test(artifact.registryShasum ?? "")
  )
    fail();
}

export function createFirstPublicationStageApprovalAttempt({ authorization, reservedAt }) {
  if (
    authorization?.schemaVersion !== 1 ||
    authorization.status !== "approval_authorized" ||
    authorization.authorizationType !== "first_publication_npm_stage_approval" ||
    !digestPattern.test(authorization.authorizationDigest ?? "") ||
    !timestamp(reservedAt)
  )
    fail();
  const body = {
    schemaVersion: 1,
    state: "reserved",
    operation: "npm_stage_approve",
    authorizationDigest: authorization.authorizationDigest,
    target: structuredClone(authorization.target),
    stage: {
      registry: authorization.binding.registry,
      idDigest: authorization.binding.stageIdDigest,
      distTag: authorization.binding.distTag,
    },
    artifact: structuredClone(authorization.binding.artifact),
    reservedAt,
    retry: "forbidden_without_reconciliation",
  };
  validateCoordinates(body.target, body.stage, body.artifact);
  return { ...body, attemptDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageApprovalAttempt(attempt) {
  if (
    !exactKeys(attempt, [
      "schemaVersion",
      "state",
      "operation",
      "authorizationDigest",
      "target",
      "stage",
      "artifact",
      "reservedAt",
      "retry",
      "attemptDigest",
    ]) ||
    attempt.schemaVersion !== 1 ||
    attempt.state !== "reserved" ||
    attempt.operation !== "npm_stage_approve" ||
    !digestPattern.test(attempt.authorizationDigest ?? "") ||
    !timestamp(attempt.reservedAt) ||
    attempt.retry !== "forbidden_without_reconciliation" ||
    !digestPattern.test(attempt.attemptDigest ?? "") ||
    attempt.attemptDigest !== canonicalDigest(withoutDigest(attempt, "attemptDigest"))
  )
    fail("first_publication_stage_approval_attempt_invalid");
  validateCoordinates(attempt.target, attempt.stage, attempt.artifact);
  return attempt;
}

export function createFirstPublicationStageApprovalReceipt(attempt) {
  validateFirstPublicationStageApprovalAttempt(attempt);
  return {
    schemaVersion: 1,
    status: "approval_command_completed",
    operation: "npm_stage_approve",
    target: structuredClone(attempt.target),
    stage: structuredClone(attempt.stage),
    artifact: structuredClone(attempt.artifact),
    evidence: "npm_cli_exit_zero",
  };
}

function validateReceipt(receipt, attempt) {
  const expected = createFirstPublicationStageApprovalReceipt(attempt);
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    fail("first_publication_stage_approval_receipt_invalid");
  }
  return receipt;
}

export function createFirstPublicationStageApprovalTerminal({
  attempt,
  state,
  completedAt,
  receipt,
}) {
  validateFirstPublicationStageApprovalAttempt(attempt);
  if (!timestamp(completedAt) || Date.parse(completedAt) < Date.parse(attempt.reservedAt)) fail();
  let body;
  if (state === "approval_command_completed") {
    validateReceipt(receipt, attempt);
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: attempt.authorizationDigest,
      completedAt,
      receipt: structuredClone(receipt),
      publicAvailability: "not_claimed",
      verification: "authenticated_public_registry_required",
      retry: "forbidden",
    };
  } else if (state === "approval_outcome_unknown") {
    if (receipt !== undefined) fail();
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: attempt.authorizationDigest,
      completedAt,
      reconciliation: "authenticated_public_release_observation_required",
      retry: "forbidden",
    };
  } else if (state === "aborted_before_approval") {
    if (receipt !== undefined) fail();
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: attempt.authorizationDigest,
      completedAt,
      retry: "new_authorization_required",
    };
  } else fail();
  return { ...body, terminalDigest: canonicalDigest(body) };
}

export function validateFirstPublicationStageApprovalTerminal(terminal) {
  const common = ["schemaVersion", "state", "attemptDigest", "authorizationDigest", "completedAt"];
  const shape =
    terminal?.state === "approval_command_completed"
      ? exactKeys(terminal, [
          ...common,
          "receipt",
          "publicAvailability",
          "verification",
          "retry",
          "terminalDigest",
        ]) &&
        terminal.publicAvailability === "not_claimed" &&
        terminal.verification === "authenticated_public_registry_required" &&
        terminal.retry === "forbidden"
      : terminal?.state === "approval_outcome_unknown"
        ? exactKeys(terminal, [...common, "reconciliation", "retry", "terminalDigest"]) &&
          terminal.reconciliation === "authenticated_public_release_observation_required" &&
          terminal.retry === "forbidden"
        : terminal?.state === "aborted_before_approval"
          ? exactKeys(terminal, [...common, "retry", "terminalDigest"]) &&
            terminal.retry === "new_authorization_required"
          : false;
  if (
    !shape ||
    terminal.schemaVersion !== 1 ||
    !digestPattern.test(terminal.attemptDigest ?? "") ||
    !digestPattern.test(terminal.authorizationDigest ?? "") ||
    !timestamp(terminal.completedAt) ||
    !digestPattern.test(terminal.terminalDigest ?? "") ||
    terminal.terminalDigest !== canonicalDigest(withoutDigest(terminal, "terminalDigest"))
  )
    fail("first_publication_stage_approval_terminal_invalid");
  return terminal;
}

export function bindFirstPublicationStageApprovalTerminal(terminal, attempt) {
  validateFirstPublicationStageApprovalAttempt(attempt);
  validateFirstPublicationStageApprovalTerminal(terminal);
  if (
    terminal.attemptDigest !== attempt.attemptDigest ||
    terminal.authorizationDigest !== attempt.authorizationDigest ||
    Date.parse(terminal.completedAt) < Date.parse(attempt.reservedAt) ||
    (terminal.state === "approval_command_completed" &&
      canonicalJson(terminal.receipt) !==
        canonicalJson(createFirstPublicationStageApprovalReceipt(attempt)))
  )
    fail("first_publication_stage_approval_terminal_conflict");
  return terminal;
}

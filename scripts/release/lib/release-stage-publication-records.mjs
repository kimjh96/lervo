import { canonicalDigest, canonicalJson } from "../../shared/release-artifact-manifest.mjs";
import {
  ReleasePublicationAuthorizationError,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;

function fail(code = "release_stage_publication_record_invalid") {
  throw new ReleasePublicationAuthorizationError(
    code,
    "The CLI stage-publication record is invalid.",
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

function validTimestamp(value) {
  return (
    typeof value === "string" && timestampPattern.test(value) && Number.isFinite(Date.parse(value))
  );
}

function bodyWithoutDigest(record, digestName) {
  const body = structuredClone(record);
  delete body[digestName];
  return body;
}

function validateStageCoordinates(target, artifact) {
  if (
    !exactKeys(target, ["registry", "package", "version", "distTag", "access"]) ||
    target.registry !== "https://registry.npmjs.org/" ||
    target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(target.version ?? "") ||
    !["latest", "next"].includes(target.distTag) ||
    target.access !== "public" ||
    !exactKeys(artifact, ["file", "sha256", "registryIntegrity", "registryShasum"]) ||
    artifact.file !== `lervo-cli-${target.version}.tgz` ||
    !sha256Pattern.test(artifact.sha256 ?? "") ||
    !sha512IntegrityPattern.test(artifact.registryIntegrity ?? "") ||
    !sha1Pattern.test(artifact.registryShasum ?? "")
  )
    fail("release_stage_publication_record_invalid");
}

export function validateReleaseStageReceipt(receipt, authorization) {
  validateReleasePublicationAuthorization(authorization);
  if (
    !exactKeys(receipt, [
      "schemaVersion",
      "status",
      "operation",
      "target",
      "artifact",
      "evidence",
    ]) ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== "stage_submission_accepted" ||
    receipt.operation !== "npm_stage_publish" ||
    receipt.evidence !== "npm_cli_exit_zero" ||
    canonicalJson(receipt.target) !== canonicalJson(authorization.target) ||
    canonicalJson(receipt.artifact) !== canonicalJson(authorization.artifact)
  )
    fail("release_stage_publication_receipt_invalid");
  return receipt;
}

export function createReleaseStageAttempt({ authorization, reservedAt }) {
  validateReleasePublicationAuthorization(authorization);
  if (!validTimestamp(reservedAt)) fail();
  const body = {
    schemaVersion: 1,
    state: "reserved",
    operation: "npm_stage_publish",
    authorizationDigest: authorization.authorizationDigest,
    target: structuredClone(authorization.target),
    artifact: structuredClone(authorization.artifact),
    reservedAt,
    retry: "forbidden_without_reconciliation",
  };
  return { ...body, attemptDigest: canonicalDigest(body) };
}

export function validateReleaseStageAttempt(attempt) {
  if (
    !exactKeys(attempt, [
      "schemaVersion",
      "state",
      "operation",
      "authorizationDigest",
      "target",
      "artifact",
      "reservedAt",
      "retry",
      "attemptDigest",
    ]) ||
    attempt.schemaVersion !== 1 ||
    attempt.state !== "reserved" ||
    attempt.operation !== "npm_stage_publish" ||
    !digestPattern.test(attempt.authorizationDigest ?? "") ||
    !validTimestamp(attempt.reservedAt) ||
    attempt.retry !== "forbidden_without_reconciliation" ||
    !digestPattern.test(attempt.attemptDigest ?? "") ||
    attempt.attemptDigest !== canonicalDigest(bodyWithoutDigest(attempt, "attemptDigest"))
  )
    fail("release_stage_publication_attempt_invalid");
  validateStageCoordinates(attempt.target, attempt.artifact);
  return attempt;
}

export function createReleaseStageTerminal({
  attempt,
  authorization,
  state,
  completedAt,
  receipt,
}) {
  validateReleaseStageAttempt(attempt);
  validateReleasePublicationAuthorization(authorization);
  if (
    attempt.authorizationDigest !== authorization.authorizationDigest ||
    !validTimestamp(completedAt)
  )
    fail();
  let body;
  if (state === "staged") {
    validateReleaseStageReceipt(receipt, authorization);
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: authorization.authorizationDigest,
      completedAt,
      receipt: structuredClone(receipt),
      review: "required_with_2fa",
      publicAvailability: "not_claimed",
      retry: "forbidden",
    };
  } else if (state === "stage_outcome_unknown") {
    if (receipt !== undefined) fail();
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: authorization.authorizationDigest,
      completedAt,
      reconciliation: "authenticated_npm_stage_review_required",
      retry: "forbidden",
    };
  } else if (state === "aborted_before_stage") {
    if (receipt !== undefined) fail();
    body = {
      schemaVersion: 1,
      state,
      attemptDigest: attempt.attemptDigest,
      authorizationDigest: authorization.authorizationDigest,
      completedAt,
      retry: "new_authorization_required",
    };
  } else fail();
  return { ...body, terminalDigest: canonicalDigest(body) };
}

export function validateReleaseStageTerminal(terminal) {
  const common = ["schemaVersion", "state", "attemptDigest", "authorizationDigest", "completedAt"];
  const validShape =
    terminal?.state === "staged"
      ? exactKeys(terminal, [
          ...common,
          "receipt",
          "review",
          "publicAvailability",
          "retry",
          "terminalDigest",
        ]) &&
        terminal.review === "required_with_2fa" &&
        terminal.publicAvailability === "not_claimed" &&
        terminal.retry === "forbidden"
      : terminal?.state === "stage_outcome_unknown"
        ? exactKeys(terminal, [...common, "reconciliation", "retry", "terminalDigest"]) &&
          terminal.reconciliation === "authenticated_npm_stage_review_required" &&
          terminal.retry === "forbidden"
        : terminal?.state === "aborted_before_stage"
          ? exactKeys(terminal, [...common, "retry", "terminalDigest"]) &&
            terminal.retry === "new_authorization_required"
          : false;
  if (
    !validShape ||
    terminal.schemaVersion !== 1 ||
    !digestPattern.test(terminal.attemptDigest ?? "") ||
    !digestPattern.test(terminal.authorizationDigest ?? "") ||
    !validTimestamp(terminal.completedAt) ||
    !digestPattern.test(terminal.terminalDigest ?? "") ||
    terminal.terminalDigest !== canonicalDigest(bodyWithoutDigest(terminal, "terminalDigest"))
  )
    fail("release_stage_publication_terminal_invalid");
  return terminal;
}

export function validateReleaseStageResultRecords({ attempt, terminal }) {
  validateReleaseStageAttempt(attempt);
  validateReleaseStageTerminal(terminal);
  if (
    terminal.attemptDigest !== attempt.attemptDigest ||
    terminal.authorizationDigest !== attempt.authorizationDigest ||
    Date.parse(terminal.completedAt) < Date.parse(attempt.reservedAt) ||
    terminal.state !== "staged" ||
    !exactKeys(terminal.receipt, [
      "schemaVersion",
      "status",
      "operation",
      "target",
      "artifact",
      "evidence",
    ]) ||
    terminal.receipt.schemaVersion !== 1 ||
    terminal.receipt.status !== "stage_submission_accepted" ||
    terminal.receipt.operation !== "npm_stage_publish" ||
    terminal.receipt.evidence !== "npm_cli_exit_zero" ||
    canonicalJson(terminal.receipt.target) !== canonicalJson(attempt.target) ||
    canonicalJson(terminal.receipt.artifact) !== canonicalJson(attempt.artifact)
  )
    fail("release_stage_publication_result_invalid");
  return { attempt, terminal };
}

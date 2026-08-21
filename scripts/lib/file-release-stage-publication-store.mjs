import { createFileImmutableAttemptStore } from "./file-immutable-attempt-store.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import { ReleasePublicationAuthorizationError } from
  "./release-publication-authorization.mjs";
import {
  validateReleaseStageAttempt,
  validateReleaseStageTerminal,
} from "./release-stage-publication-records.mjs";

function fail(code = "release_stage_publication_store_invalid") {
  throw new ReleasePublicationAuthorizationError(
    code,
    "CLI stage 게시 기록 저장소가 올바르지 않습니다.",
  );
}

function bindTerminal(terminal, attempt) {
  validateReleaseStageTerminal(terminal);
  if (
    terminal.attemptDigest !== attempt.attemptDigest ||
    terminal.authorizationDigest !== attempt.authorizationDigest ||
    (terminal.state === "staged" && (
      canonicalJson(terminal.receipt.target) !== canonicalJson(attempt.target) ||
      canonicalJson(terminal.receipt.artifact) !== canonicalJson(attempt.artifact)
    ))
  ) fail("release_stage_publication_terminal_conflict");
  return terminal;
}

export function createFileReleaseStagePublicationStore({ rootDirectory }) {
  return createFileImmutableAttemptStore({
    rootDirectory,
    validateAttempt: validateReleaseStageAttempt,
    validateTerminal: validateReleaseStageTerminal,
    bindTerminal,
    fail,
    codes: {
      inputInvalid: "release_stage_publication_store_input_invalid",
      invalid: "release_stage_publication_store_invalid",
      unsafe: "release_stage_publication_store_unsafe",
      corrupt: "release_stage_publication_store_corrupt",
      alreadyTerminal: "release_stage_publication_already_terminal",
      alreadyAttempted: "release_stage_publication_already_attempted",
      incomplete: "release_stage_publication_store_incomplete",
    },
  });
}

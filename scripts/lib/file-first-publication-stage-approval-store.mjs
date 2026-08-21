import { createFileImmutableAttemptStore } from "./file-immutable-attempt-store.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  bindFirstPublicationStageApprovalTerminal,
  validateFirstPublicationStageApprovalAttempt,
  validateFirstPublicationStageApprovalTerminal,
} from "./first-publication-stage-approval-records.mjs";

function fail(code = "first_publication_stage_approval_store_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI npm stage 승인 기록 저장소가 올바르지 않습니다.",
  );
}

export function createFileFirstPublicationStageApprovalStore({ rootDirectory }) {
  return createFileImmutableAttemptStore({
    rootDirectory,
    validateAttempt: validateFirstPublicationStageApprovalAttempt,
    validateTerminal: validateFirstPublicationStageApprovalTerminal,
    bindTerminal: bindFirstPublicationStageApprovalTerminal,
    fail,
    codes: {
      inputInvalid: "first_publication_stage_approval_store_input_invalid",
      invalid: "first_publication_stage_approval_store_invalid",
      unsafe: "first_publication_stage_approval_store_unsafe",
      corrupt: "first_publication_stage_approval_store_corrupt",
      alreadyTerminal: "first_publication_stage_approval_already_terminal",
      alreadyAttempted: "first_publication_stage_approval_already_attempted",
      incomplete: "first_publication_stage_approval_store_incomplete",
    },
  });
}

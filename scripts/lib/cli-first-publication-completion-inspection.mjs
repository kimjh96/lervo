import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationCompletionInspection,
  validateFirstPublicationCompletionInspectionDocument,
} from "./first-publication-completion-inspection.mjs";
import { readFirstPublicationCompletionInspectionSources } from
  "./first-publication-completion-inspection-sources.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_completion_inspection_input_invalid",
    "CLI 최초 게시 완료 점검 입력이 올바르지 않습니다.",
  );
}

export async function inspectCliFirstPublicationCompletion(input, dependencies = {}) {
  if (
    !isAbsolute(input?.stageApprovalBundlePath ?? "") ||
    !isAbsolute(input?.transitionReceiptPath ?? "")
  ) fail();
  const readSources = dependencies.readSources ??
    readFirstPublicationCompletionInspectionSources;
  const sources = await readSources(input, dependencies);
  const report = createFirstPublicationCompletionInspection({
    ...sources,
    inspectedAt: (dependencies.clock ?? (() => new Date().toISOString()))(),
  });
  await sources.assertUnchanged();
  return validateFirstPublicationCompletionInspectionDocument(report);
}

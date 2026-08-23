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
    "The CLI first-publication completion-inspection input is invalid.",
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

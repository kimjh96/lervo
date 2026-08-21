import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { createFirstPublicationStageEvidenceBundle } from
  "./first-publication-stage-evidence-bundle.mjs";
import { makeFirstPublicationStageEvidenceBundleRelativePath } from
  "./first-publication-stage-evidence-bundle-paths.mjs";
import { readFirstPublicationStageEvidenceSetSources } from
  "./first-publication-stage-evidence-set-sources.mjs";

function fail(code = "first_publication_stage_evidence_bundle_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 stage 증거 묶음 입력이 올바르지 않습니다.",
  );
}

function validInput(input) {
  return input?.write === true && [
    input.stageReviewReportPath,
    input.decisionPath,
    input.authorizationPath,
    input.resultDirectory,
    input.reconciliationReportPath,
    input.outputPath,
  ].every((value) => isAbsolute(value ?? ""));
}

export async function createCliFirstPublicationStageEvidenceBundle(
  input,
  dependencies = {},
) {
  if (!validInput(input)) fail();
  const paths = {
    stageReviewReport: makeFirstPublicationStageEvidenceBundleRelativePath(
      input.outputPath,
      input.stageReviewReportPath,
    ),
    decision: makeFirstPublicationStageEvidenceBundleRelativePath(
      input.outputPath,
      input.decisionPath,
    ),
    authorization: makeFirstPublicationStageEvidenceBundleRelativePath(
      input.outputPath,
      input.authorizationPath,
    ),
    resultDirectory: makeFirstPublicationStageEvidenceBundleRelativePath(
      input.outputPath,
      input.resultDirectory,
    ),
    reconciliationReport: makeFirstPublicationStageEvidenceBundleRelativePath(
      input.outputPath,
      input.reconciliationReportPath,
    ),
  };
  const readSources = dependencies.readSources ??
    readFirstPublicationStageEvidenceSetSources;
  const sources = await readSources(input, dependencies);
  const bundle = createFirstPublicationStageEvidenceBundle({ paths, evidenceSet: sources });
  await sources.assertUnchanged();
  try {
    await writeFile(input.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail(
      "first_publication_stage_evidence_bundle_output_exists",
    );
    throw error;
  }
  return bundle;
}

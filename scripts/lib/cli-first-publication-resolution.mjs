import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationReconciliationReport,
  validateFirstPublicationReconciliationReport,
} from "./first-publication-reconciliation.mjs";
import {
  createFirstPublicationResolution,
  validateFirstPublicationResolution,
  validateFirstPublicationResolutionDocument,
} from "./first-publication-resolution.mjs";
import { readFirstPublicationResolutionSources } from
  "./first-publication-resolution-sources.mjs";
import { observeFirstPublicationReconciliation } from
  "./npm-first-publication-reconciliation-observer.mjs";

function fail(code = "first_publication_resolution_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 결과 확정 입력이 올바르지 않습니다.",
  );
}

export async function resolveCliFirstPublication(options, dependencies = {}) {
  if (
    options?.online !== true ||
    !isAbsolute(options.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options.bootstrapPath ?? "") ||
    !isAbsolute(options.armingAuthorizationPath ?? "") ||
    !isAbsolute(options.reservationRoot ?? "") ||
    !isAbsolute(options.reconciliationReportPath ?? "") ||
    !isAbsolute(options.decisionPath ?? "")
  ) fail(options?.online === true ? undefined : "first_publication_resolution_online_required");
  const readSources = dependencies.readSources ?? readFirstPublicationResolutionSources;
  const observe = dependencies.observe ?? observeFirstPublicationReconciliation;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const sources = await readSources(options, dependencies);
  if (sources.reconciliationReport.outcome !== "published") {
    fail("first_publication_resolution_fresh_observation_required");
  }
  const npmObservation = await observe(sources.bootstrap.target);
  const resolvedAt = clock();
  const freshEvidence = { ...sources, npmObservation, observedAt: resolvedAt };
  const freshReconciliationReport = createFirstPublicationReconciliationReport(freshEvidence);
  validateFirstPublicationReconciliationReport(freshReconciliationReport, freshEvidence);
  const evidence = { ...sources, freshReconciliationReport, resolvedAt };
  const resolution = createFirstPublicationResolution(evidence);
  validateFirstPublicationResolution(resolution, evidence);
  await sources.assertUnchanged();
  return resolution;
}

export async function writeFirstPublicationResolution(outputPath, resolution) {
  if (!isAbsolute(outputPath)) fail();
  validateFirstPublicationResolutionDocument(resolution);
  try {
    await writeFile(outputPath, `${JSON.stringify(resolution, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail("first_publication_resolution_output_exists");
    throw error;
  }
}

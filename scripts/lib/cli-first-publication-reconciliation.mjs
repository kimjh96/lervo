import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationReconciliationReport,
  validateFirstPublicationReconciliationReport,
} from "./first-publication-reconciliation.mjs";
import { readFirstPublicationReconciliationSources } from
  "./first-publication-reconciliation-sources.mjs";
import { observeFirstPublicationReconciliation } from
  "./npm-first-publication-reconciliation-observer.mjs";

function fail(code = "first_publication_reconciliation_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication reconciliation input is invalid.",
  );
}

export async function reconcileCliFirstPublication(options, dependencies = {}) {
  if (
    options?.online !== true ||
    !isAbsolute(options.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options.bootstrapPath ?? "") ||
    !isAbsolute(options.armingAuthorizationPath ?? "") ||
    !isAbsolute(options.reservationRoot ?? "")
  ) fail(options?.online === true ? undefined : "first_publication_reconciliation_online_required");
  const readSources = dependencies.readSources ?? readFirstPublicationReconciliationSources;
  const observe = dependencies.observe ?? observeFirstPublicationReconciliation;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const sources = await readSources(options, dependencies);
  const npmObservation = await observe(sources.bootstrap.target);
  const observedAt = clock();
  const evidence = { ...sources, npmObservation, observedAt };
  const report = createFirstPublicationReconciliationReport(evidence);
  validateFirstPublicationReconciliationReport(report, evidence);
  await sources.assertUnchanged();
  return report;
}

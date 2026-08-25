import { isAbsolute } from "node:path";

import { canonicalJson } from "./release-artifact-manifest.mjs";
import {
  ReleasePublicationAuthorizationError,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  createReleaseStageAttempt,
  createReleaseStageTerminal,
  validateReleaseStageReceipt,
} from "./release-stage-publication-records.mjs";

function fail(code, message = "The CLI stage-publication execution input is invalid.") {
  throw new ReleasePublicationAuthorizationError(code, message);
}

async function writeTerminal(store, method, terminal) {
  const stored = await store[method](terminal);
  if (canonicalJson(stored) !== canonicalJson(terminal)) {
    fail("release_stage_publication_store_invalid");
  }
  return stored;
}

async function markUnknown(store, attempt, authorization, clock) {
  const terminal = createReleaseStageTerminal({
    attempt,
    authorization,
    state: "stage_outcome_unknown",
    completedAt: clock(),
  });
  try {
    await writeTerminal(store, "markUnknown", terminal);
  } catch {
    // The immutable attempt still forbids a blind retry when terminal persistence fails.
  }
}

export async function executeReleaseStagePublication(
  source,
  { store, prepareStage, clock = () => new Date().toISOString() },
) {
  const authorization = validateReleasePublicationAuthorization(source?.authorization);
  if (
    !isAbsolute(source?.releaseDirectory ?? "") ||
    !isAbsolute(source?.tarballPath ?? "") ||
    typeof source.assertUnchanged !== "function" ||
    typeof store?.reserve !== "function" ||
    typeof store.complete !== "function" ||
    typeof store.abort !== "function" ||
    typeof store.markUnknown !== "function" ||
    typeof prepareStage !== "function" ||
    typeof clock !== "function"
  )
    fail("release_stage_publication_execution_input_invalid");

  const publisherInput = {
    target: authorization.target,
    artifact: authorization.artifact,
    tarballPath: source.tarballPath,
  };
  const prepared = await prepareStage(publisherInput);
  if (
    prepared === null ||
    typeof prepared !== "object" ||
    typeof prepared.stage !== "function" ||
    typeof prepared.dispose !== "function"
  )
    fail("release_stage_publication_publisher_invalid");

  let attempt;
  try {
    await source.assertUnchanged();
    attempt = createReleaseStageAttempt({ authorization, reservedAt: clock() });
    await writeTerminal(store, "reserve", attempt);
    try {
      await source.assertUnchanged();
    } catch (error) {
      const terminal = createReleaseStageTerminal({
        attempt,
        authorization,
        state: "aborted_before_stage",
        completedAt: clock(),
      });
      try {
        await writeTerminal(store, "abort", terminal);
      } catch {
        fail("release_stage_publication_store_incomplete");
      }
      throw error;
    }

    let receipt;
    try {
      receipt = await prepared.stage();
      validateReleaseStageReceipt(receipt, authorization);
      await source.assertUnchanged();
    } catch {
      await markUnknown(store, attempt, authorization, clock);
      fail(
        "release_stage_publication_outcome_unknown",
        "The result after the npm stage call is ambiguous; the same publication must not be retried.",
      );
    }
    const terminal = createReleaseStageTerminal({
      attempt,
      authorization,
      state: "staged",
      completedAt: clock(),
      receipt,
    });
    try {
      return await writeTerminal(store, "complete", terminal);
    } catch {
      await markUnknown(store, attempt, authorization, clock);
      fail(
        "release_stage_publication_outcome_unknown",
        "The result after the npm stage call is ambiguous; the same publication must not be retried.",
      );
    }
  } finally {
    try {
      await prepared.dispose();
    } catch {
      // Isolated client files contain no registry write credential and do not alter the receipt.
    }
  }
}

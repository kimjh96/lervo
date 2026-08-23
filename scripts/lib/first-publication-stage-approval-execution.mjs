import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageApprovalAttempt,
  createFirstPublicationStageApprovalReceipt,
  createFirstPublicationStageApprovalTerminal,
} from "./first-publication-stage-approval-records.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

async function writeTerminal(store, method, terminal) {
  try {
    const written = await store[method](terminal);
    if (canonicalJson(written) !== canonicalJson(terminal)) throw new Error("invalid terminal");
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_stage_approval_store_failed",
      "The npm stage approval terminal record could not be saved.",
    );
  }
}

async function markUnknown(store, attempt, completedAt) {
  const terminal = createFirstPublicationStageApprovalTerminal({
    attempt,
    state: "approval_outcome_unknown",
    completedAt,
  });
  try {
    await store.markUnknown(terminal);
  } catch {
    // The immutable attempt still makes a blind retry unsafe.
  }
}

export async function executeFirstPublicationStageApproval({
  authorization,
  validateAuthorization,
  assertUnchanged,
}, {
  store,
  prepareApproval,
  clock = () => new Date().toISOString(),
}) {
  if (
    typeof validateAuthorization !== "function" ||
    typeof assertUnchanged !== "function" || typeof prepareApproval !== "function" ||
    typeof store?.reserve !== "function" || typeof store.complete !== "function" ||
    typeof store.abort !== "function" || typeof store.markUnknown !== "function"
  ) fail(
    "first_publication_stage_approval_execution_input_invalid",
    "The npm stage approval execution input is invalid.",
  );
  validateAuthorization(clock());
  const prepared = await prepareApproval();
  try {
    await assertUnchanged();
    const reservedAt = clock();
    validateAuthorization(reservedAt);
    const attempt = createFirstPublicationStageApprovalAttempt({
      authorization,
      reservedAt,
    });
    try {
      const written = await store.reserve(attempt);
      if (canonicalJson(written) !== canonicalJson(attempt)) throw new Error("invalid attempt");
    } catch (error) {
      if (error instanceof FirstPublicationBootstrapError) throw error;
      fail(
        "first_publication_stage_approval_store_failed",
        "The npm stage approval attempt could not be saved.",
      );
    }
    let approvalStarted = false;
    try {
      await prepared.recheck();
      await assertUnchanged();
      validateAuthorization(clock());
      approvalStarted = true;
      await prepared.approve();
      await assertUnchanged();
      const receipt = createFirstPublicationStageApprovalReceipt(attempt);
      const terminal = createFirstPublicationStageApprovalTerminal({
        attempt,
        state: "approval_command_completed",
        completedAt: clock(),
        receipt,
      });
      try {
        await writeTerminal(store, "complete", terminal);
      } catch {
        await markUnknown(store, attempt, terminal.completedAt);
        throw new Error("terminal completion failed");
      }
      return terminal;
    } catch (error) {
      if (!approvalStarted) {
        const aborted = createFirstPublicationStageApprovalTerminal({
          attempt,
          state: "aborted_before_approval",
          completedAt: clock(),
        });
        await writeTerminal(store, "abort", aborted);
        throw error;
      }
      await markUnknown(store, attempt, clock());
      fail(
        "first_publication_stage_approval_outcome_unknown",
        "The npm stage approval result is ambiguous and must be reconciled before retrying.",
      );
    }
  } finally {
    await prepared.dispose();
  }
}

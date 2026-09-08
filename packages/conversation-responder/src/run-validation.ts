import {
  maximumManagedRunEvidenceEvents,
  validateManagedProviderRunEvidence,
  type ManagedProviderRunResult,
} from "@lervo/execution-contract";
import type { SharedContextPublication } from "@lervo/schemas";
import { collectRunEventsBounded, type EventStore } from "@lervo/storage-contract";

import { ManagedConversationResponseError } from "./types.js";

export function validateConversationManagedRun(input: {
  run: ManagedProviderRunResult;
  events: EventStore;
  requestDigest: string;
  agentId: string | null;
  roleId: string;
  targetTurnId: string;
  publications: readonly SharedContextPublication[];
}): void {
  const { run } = input;
  if (
    run.session.executionMode !== "read_only" ||
    run.managedChanges.length !== 0 ||
    run.beforeRevision !== run.afterRevision ||
    run.session.roleId !== input.roleId ||
    run.turn.targetTurnId !== input.targetTurnId
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The conversation response managed run did not preserve the read-only role and result coordinates.",
    );
  }
  let runEvents;
  try {
    runEvents = collectRunEventsBounded({
      events: input.events,
      runId: run.session.runId,
      maximumEvents: maximumManagedRunEvidenceEvents,
    });
  } catch (error) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The conversation response managed run event range could not be verified.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  const requested = runEvents.filter((event) => event.type === "run.requested");
  const causality = runEvents.filter((event) => event.type === "work.causality.recorded");
  if (
    requested.length !== 1 ||
    requested[0]!.payload.requestDigest !== input.requestDigest ||
    requested[0]!.payload.role !== input.roleId ||
    causality.length !== 1 ||
    causality[0]!.payload.relationship !== "root" ||
    causality[0]!.payload.agentId !== input.agentId
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The conversation source hash or hired-agent identity is not linked to the managed run.",
    );
  }
  try {
    validateManagedProviderRunEvidence({
      run,
      events: runEvents,
      sharedContextPublications: input.publications,
    });
  } catch (error) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The E2/E3 shared-context evidence required for the conversation response could not be verified.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

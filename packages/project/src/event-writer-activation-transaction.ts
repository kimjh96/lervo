import { chmod, lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { EventWriterActivationEvidence, EventWriterCoordinate } from "@lervo/schemas";

import type { EventWriterActivationPlan } from "./event-writer-activation-plan.js";
import {
  ensureEventWriterDataDirectory,
  eventWriterActivationTransactionName,
  syncEventWriterDirectory,
  type EventWriterActivationJournal,
  writeDurableEventWriterFile,
} from "./event-writer-activation-transaction-io.js";
import { readEventWriterCoordinate } from "./event-writer-coordinate-contract.js";
import { EventWriterActivationError } from "./event-writer-errors.js";
import {
  eventWriterActivationObservationHash,
  readEventWriterActivationEvidence,
} from "./event-writer-evidence.js";
import {
  planEventWriterActivation,
  planEventWriterRollback,
} from "./event-writer-coordinate-store.js";
import { resolveProjectPaths } from "./layout.js";
import { recoverEventWriterActivation } from "./event-writer-activation-recovery.js";

export type EventWriterActivationCheckpoint = "staged" | "original_moved" | "published";

export interface EventWriterActivationReceipt {
  schemaVersion: 1;
  receiptKind: "event_writer_activation_applied" | "event_writer_rollback_applied";
  planId: string;
  projectId: string;
  selectedEventSchemaVersion: 1 | 2;
  coordinateHash: string;
  activationId: string | null;
}

function coordinateEvidence(coordinate: EventWriterCoordinate): EventWriterActivationEvidence {
  if (coordinate.selectedEventSchemaVersion !== 2) {
    throw new EventWriterActivationError(
      "event_writer_plan_stale",
      "The activation plan has no version 2 evidence.",
    );
  }
  return {
    schemaVersion: 1,
    projectId: coordinate.projectId,
    observedAt: coordinate.activationEvidence.observedAt,
    readers: coordinate.activationEvidence.readers,
  };
}

export async function applyEventWriterActivationPlan(input: {
  plan: EventWriterActivationPlan;
  approval: string;
  currentEvidence?: unknown;
  failureInjector?: (
    checkpoint: EventWriterActivationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<EventWriterActivationReceipt> {
  if (input.approval !== input.plan.planId) {
    throw new EventWriterActivationError(
      "event_writer_plan_stale",
      "Approval must equal the current event writer activation plan ID.",
    );
  }
  if (input.plan.status !== "ready") {
    throw new EventWriterActivationError(
      "event_writer_activation_blocked",
      "Only a ready event writer activation plan can be applied.",
    );
  }
  const plannedEvidence = input.plan.activationEvidence;
  if (plannedEvidence?.schemaVersion === 2) {
    if (input.currentEvidence === undefined) {
      throw new EventWriterActivationError(
        "reader_inventory_revalidation_required",
        "Distributed activation requires a current authoritative reader inventory observation.",
      );
    }
    const currentEvidence = readEventWriterActivationEvidence(input.currentEvidence);
    if (
      currentEvidence.schemaVersion !== 2 ||
      eventWriterActivationObservationHash(currentEvidence) !==
        eventWriterActivationObservationHash(plannedEvidence)
    ) {
      throw new EventWriterActivationError(
        "event_writer_plan_stale",
        "The authoritative reader inventory changed after planning.",
      );
    }
  }
  const current =
    input.plan.desiredCoordinate.selectedEventSchemaVersion === 2
      ? await planEventWriterActivation({
          repositoryRoot: input.plan.repositoryRoot,
          evidence:
            input.plan.activationEvidence ?? coordinateEvidence(input.plan.desiredCoordinate),
        })
      : await planEventWriterRollback(input.plan.repositoryRoot);
  if (
    current.planId !== input.plan.planId ||
    current.desiredContentHash !== input.plan.desiredContentHash ||
    current.status !== "ready"
  ) {
    throw new EventWriterActivationError(
      "event_writer_plan_stale",
      "The event writer activation inputs changed after planning.",
    );
  }
  const paths = resolveProjectPaths(input.plan.repositoryRoot);
  await ensureEventWriterDataDirectory(paths.data);
  const transaction = resolve(paths.data, eventWriterActivationTransactionName);
  try {
    await lstat(transaction);
    throw new EventWriterActivationError(
      "event_writer_recovery_required",
      "Recover the previous event writer activation before another apply.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const preparing = await mkdtemp(resolve(paths.data, ".event-contract-preparing-"));
  await chmod(preparing, 0o700);
  const journal: EventWriterActivationJournal = {
    schemaVersion: 1,
    transactionKind: "event_writer_selection",
    planId: input.plan.planId,
    projectId: input.plan.projectId,
    beforeHash: input.plan.currentContentHash,
    afterHash: input.plan.desiredContentHash,
  };
  try {
    await writeDurableEventWriterFile(
      resolve(preparing, "journal.json"),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await writeDurableEventWriterFile(resolve(preparing, "next.json"), input.plan.desiredContent);
    await rename(preparing, transaction);
    await syncEventWriterDirectory(paths.data);
  } catch (error) {
    await rm(preparing, { recursive: true, force: true });
    throw error;
  }
  let interrupted = false;
  const checkpoint = async (name: EventWriterActivationCheckpoint) => {
    if ((await input.failureInjector?.(name)) === "interrupt") {
      interrupted = true;
      throw new Error("simulated interruption");
    }
  };
  try {
    await checkpoint("staged");
    if (input.plan.currentContentHash !== null) {
      await rename(paths.eventContract, resolve(transaction, "before.json"));
      await syncEventWriterDirectory(paths.data);
      await syncEventWriterDirectory(transaction);
      await checkpoint("original_moved");
    }
    await rename(resolve(transaction, "next.json"), paths.eventContract);
    await syncEventWriterDirectory(paths.data);
    await syncEventWriterDirectory(transaction);
    await checkpoint("published");
    await rm(transaction, { recursive: true });
    await syncEventWriterDirectory(paths.data);
  } catch (error) {
    if (interrupted) {
      throw new EventWriterActivationError(
        "event_writer_recovery_required",
        "Interrupted event writer activation requires explicit recovery.",
        { cause: error },
      );
    }
    const recovery = await recoverEventWriterActivation(paths.repositoryRoot);
    if (recovery.status !== "completed") throw error;
  }
  const coordinate = readEventWriterCoordinate(
    JSON.parse(input.plan.desiredContent),
    input.plan.projectId,
  );
  return {
    schemaVersion: 1,
    receiptKind:
      coordinate.selectedEventSchemaVersion === 2
        ? "event_writer_activation_applied"
        : "event_writer_rollback_applied",
    planId: input.plan.planId,
    projectId: input.plan.projectId,
    selectedEventSchemaVersion: coordinate.selectedEventSchemaVersion,
    coordinateHash: input.plan.desiredContentHash,
    activationId:
      coordinate.selectedEventSchemaVersion === 2
        ? coordinate.activationEvidence.activationId
        : null,
  };
}

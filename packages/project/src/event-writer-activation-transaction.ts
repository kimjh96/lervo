import { chmod, lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, type EventSchemaVersion } from "@lervo/event-contract";

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
  selectedEventSchemaVersion: EventSchemaVersion;
  coordinateHash: string;
  activationId: string | null;
}

export async function applyEventWriterActivationPlan(input: {
  plan: EventWriterActivationPlan;
  approval: string;
  currentEvidence?: unknown;
  failureInjector?: (
    checkpoint: EventWriterActivationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<EventWriterActivationReceipt> {
  const plan = structuredClone(input.plan);
  const { approval, failureInjector } = input;
  if (approval !== plan.planId) {
    throw new EventWriterActivationError(
      "event_writer_plan_stale",
      "Approval must equal the current event writer activation plan ID.",
    );
  }
  if (plan.status !== "ready") {
    throw new EventWriterActivationError(
      "event_writer_activation_blocked",
      "Only a ready event writer activation plan can be applied.",
    );
  }
  const plannedEvidence = plan.activationEvidence;
  if (
    plannedEvidence?.schemaVersion === 2 ||
    plan.desiredCoordinate.selectedEventSchemaVersion >= 3
  ) {
    if (input.currentEvidence === undefined) {
      throw new EventWriterActivationError(
        "reader_inventory_revalidation_required",
        "This activation requires a current authoritative reader inventory observation.",
      );
    }
    const currentEvidence = readEventWriterActivationEvidence(input.currentEvidence);
    if (
      plannedEvidence === null ||
      currentEvidence.schemaVersion !== plannedEvidence.schemaVersion ||
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
    plan.desiredCoordinate.selectedEventSchemaVersion !== 1
      ? await planEventWriterActivation({
          repositoryRoot: plan.repositoryRoot,
          targetEventSchemaVersion: plan.desiredCoordinate.selectedEventSchemaVersion,
          evidence: plan.activationEvidence,
        })
      : await planEventWriterRollback(plan.repositoryRoot);
  if (current.status !== "ready" || canonicalJson(current) !== canonicalJson(plan)) {
    throw new EventWriterActivationError(
      "event_writer_plan_stale",
      "The event writer activation inputs changed after planning.",
    );
  }
  const paths = resolveProjectPaths(current.repositoryRoot);
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
    planId: current.planId,
    projectId: current.projectId,
    beforeHash: current.currentContentHash,
    afterHash: current.desiredContentHash,
  };
  try {
    await writeDurableEventWriterFile(
      resolve(preparing, "journal.json"),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await writeDurableEventWriterFile(resolve(preparing, "next.json"), current.desiredContent);
    await rename(preparing, transaction);
    await syncEventWriterDirectory(paths.data);
  } catch (error) {
    await rm(preparing, { recursive: true, force: true });
    throw error;
  }
  let interrupted = false;
  const checkpoint = async (name: EventWriterActivationCheckpoint) => {
    if ((await failureInjector?.(name)) === "interrupt") {
      interrupted = true;
      throw new Error("simulated interruption");
    }
  };
  try {
    await checkpoint("staged");
    if (current.currentContentHash !== null) {
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
    JSON.parse(current.desiredContent),
    current.projectId,
  );
  return {
    schemaVersion: 1,
    receiptKind:
      coordinate.selectedEventSchemaVersion !== 1
        ? "event_writer_activation_applied"
        : "event_writer_rollback_applied",
    planId: current.planId,
    projectId: current.projectId,
    selectedEventSchemaVersion: coordinate.selectedEventSchemaVersion,
    coordinateHash: current.desiredContentHash,
    activationId:
      coordinate.selectedEventSchemaVersion !== 1
        ? coordinate.activationEvidence.activationId
        : null,
  };
}

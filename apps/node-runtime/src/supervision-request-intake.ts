import { NodeSupervisionStore } from "./supervision-store.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionRequestInput } from "./supervision-request-binding.js";
import { SupervisionRequestRefusedError } from "./supervision-request-refusal.js";
import {
  resolveStandingSupervisionBinding,
  startStandingSuccessor,
} from "./supervision-standing.js";
import { openProjectStorage } from "@lervo/project-storage";

const DEFAULT_ADMISSION_DEADLINE_MS = 30_000;
const MAXIMUM_ADMISSION_DEADLINE_MS = 600_000;

/**
 * Both local and conversation ingress use the same installed owner lease and canonical writer.
 * The owner loop holds that lease for a whole cycle, so admission polls until `admissionDeadlineMs`
 * elapses and then refuses with `owner_busy` without writing anything.
 */
export async function admitSupervisionRequest(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  request: SupervisionRequestInput;
  now?(): string;
  admissionDeadlineMs?: number;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const deadlineMs = input.admissionDeadlineMs ?? DEFAULT_ADMISSION_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 0 ||
    deadlineMs > MAXIMUM_ADMISSION_DEADLINE_MS
  )
    throw new SupervisionRequestRefusedError(
      "request_invalid",
      "The supervised request admission deadline is invalid.",
    );
  const store = await NodeSupervisionStore.open({
    repositoryRoot: input.repositoryRoot,
    binding: input.binding,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  try {
    const deadline = Date.now() + deadlineMs;
    let result = await store.withOwner((owner) => owner.bindRequest(input.request));
    while (result === null && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      result = await store.withOwner((owner) => owner.bindRequest(input.request));
    }
    if (result !== null) return result;
    throw new SupervisionRequestRefusedError(
      "owner_busy",
      "The installed supervision owner is busy; request admission was not recorded.",
    );
  } finally {
    await store.close();
  }
}

/**
 * Standing intake: binds under the lineage's current goal, and when that goal is settled starts
 * the next successor goal under the root mandate's reviewed grant before binding. The returned
 * binding is the one the runtime must follow afterwards.
 */
export async function admitStandingSupervisionRequest(input: {
  repositoryRoot: string;
  root: NodeSupervisionBinding;
  request: SupervisionRequestInput;
  provider: "codex" | "claude";
  now?(): string;
  admissionDeadlineMs?: number;
}): Promise<{
  eventId: string;
  duplicate: boolean;
  binding: NodeSupervisionBinding;
  rebound: boolean;
}> {
  const now = input.now ?? (() => new Date().toISOString());
  const storage = await openProjectStorage(input.repositoryRoot);
  let current;
  try {
    current = await resolveStandingSupervisionBinding(storage, input.root, now);
  } finally {
    await storage.close();
  }
  const admit = (binding: NodeSupervisionBinding) =>
    admitSupervisionRequest({
      repositoryRoot: input.repositoryRoot,
      binding,
      request: input.request,
      now,
      ...(input.admissionDeadlineMs === undefined
        ? {}
        : { admissionDeadlineMs: input.admissionDeadlineMs }),
    });
  try {
    return { ...(await admit(current.binding)), binding: current.binding, rebound: false };
  } catch (error) {
    if (!(error instanceof SupervisionRequestRefusedError) || error.code !== "workstream_inactive")
      throw error;
  }
  const transitionStorage = await openProjectStorage(input.repositoryRoot);
  let binding: NodeSupervisionBinding;
  try {
    binding = await startStandingSuccessor({
      repositoryRoot: input.repositoryRoot,
      storage: transitionStorage,
      current,
      request: { request: input.request.request, contentHash: input.request.contentHash },
      provider: input.provider,
      now,
    });
  } finally {
    await transitionStorage.close();
  }
  return { ...(await admit(binding)), binding, rebound: true };
}

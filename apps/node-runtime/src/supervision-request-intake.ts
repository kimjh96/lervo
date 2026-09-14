import { NodeSupervisionStore } from "./supervision-store.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionRequestInput } from "./supervision-request-binding.js";
import { SupervisionRequestRefusedError } from "./supervision-request-refusal.js";

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

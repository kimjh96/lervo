import { NodeSupervisionStore } from "./supervision-store.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionRequestInput } from "./supervision-request-binding.js";

/** Both local and conversation ingress use the same installed owner lease and canonical writer. */
export async function admitSupervisionRequest(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  request: SupervisionRequestInput;
  now?(): string;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const store = await NodeSupervisionStore.open({
    repositoryRoot: input.repositoryRoot,
    binding: input.binding,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  try {
    const deadline = Date.now() + 30_000;
    let result = await store.withOwner((owner) => owner.bindRequest(input.request));
    while (result === null && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      result = await store.withOwner((owner) => owner.bindRequest(input.request));
    }
    if (result !== null) return result;
    throw new Error("The installed supervision owner is busy; request admission was not recorded.");
  } finally {
    await store.close();
  }
}

import { type AdapterNormalizedEvent, type AdapterSession, validateSchema } from "@lervo/schemas";

import { ManagedContextError, type ManagedRunCoordinates } from "./types.js";

function assertAdapterMessage(value: unknown, label: string): void {
  const result = validateSchema("adapter", value);
  if (!result.valid) {
    throw new ManagedContextError(
      "context_contract_invalid",
      `${label} does not satisfy the adapter schema.`,
    );
  }
}

export function adapterInvalidationReason(input: {
  coordinates: ManagedRunCoordinates;
  session: AdapterSession;
  event: AdapterNormalizedEvent;
  injectedProviderSessionId: string | undefined;
}): "context_compacted" | "session_restarted" | null {
  assertAdapterMessage(input.session, "Adapter session");
  assertAdapterMessage(input.event, "Adapter normalized event");
  const { coordinates, session, event } = input;
  if (
    session.projectId !== coordinates.projectId ||
    session.runId !== coordinates.runId ||
    session.sessionId !== coordinates.sessionId ||
    session.roleId !== coordinates.roleId ||
    event.projectId !== coordinates.projectId ||
    event.runId !== coordinates.runId ||
    event.sessionId !== coordinates.sessionId ||
    event.providerSessionId !== session.providerSessionId ||
    (input.injectedProviderSessionId !== undefined &&
      input.injectedProviderSessionId !== session.providerSessionId)
  ) {
    throw new ManagedContextError(
      "context_contract_invalid",
      "The adapter signal is not bound to the current managed run and provider session.",
    );
  }
  if (event.type === "provider.context.compacted") return "context_compacted";
  if (event.type === "provider.session.restarted") return "session_restarted";
  return null;
}

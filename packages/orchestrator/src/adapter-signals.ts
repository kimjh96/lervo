import {
  type AdapterNormalizedEvent,
  type AdapterSession,
  validateSchema,
} from "@roven/schemas";

import { ManagedContextError, type ManagedRunCoordinates } from "./types.js";

function assertAdapterMessage(value: unknown, label: string): void {
  const result = validateSchema("adapter", value);
  if (!result.valid) {
    throw new ManagedContextError(
      "context_contract_invalid",
      `${label}이 adapter schema를 통과하지 못했습니다.`,
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
      "Adapter signal이 현재 managed run과 provider session에 묶여 있지 않습니다.",
    );
  }
  if (event.type === "provider.context.compacted") return "context_compacted";
  if (event.type === "provider.session.restarted") return "session_restarted";
  return null;
}

import type { EventType } from "@lervo/schemas";

export function validateAssignmentAccessModePayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (type !== "assignment.created" && type !== "assignment.claimed") return;
  if (
    Object.hasOwn(payload, "accessMode") &&
    payload.accessMode !== "read_only" &&
    payload.accessMode !== "write"
  )
    throw new TypeError("The assignment access mode is invalid.");
}

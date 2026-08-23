import type { EventEnvelope } from "@lervo/schemas";

import { KnowledgeGraphContractError } from "./types.js";

export type EventPayload = Record<string, unknown>;

export function eventPayload(event: EventEnvelope): EventPayload {
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    throw new KnowledgeGraphContractError("projection_invalid", "The graph projection event payload is invalid.");
  }
  return event.payload as EventPayload;
}

export function requiredText(payload: EventPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new KnowledgeGraphContractError("projection_invalid", `${key} graph coordinate is invalid.`);
  }
  return value;
}

export function optionalText(payload: EventPayload, key: string): string | null {
  const value = payload[key];
  if (value === null) return null;
  return requiredText(payload, key);
}

export function requiredTexts(payload: EventPayload, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new KnowledgeGraphContractError("projection_invalid", `${key} graph coordinate set is invalid.`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.length < 1 || item.length > 500) {
      throw new KnowledgeGraphContractError("projection_invalid", `${key} graph coordinate is invalid.`);
    }
    return item;
  });
}

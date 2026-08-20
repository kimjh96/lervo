import type { EventEnvelope } from "@lervo/schemas";

import { KnowledgeGraphContractError } from "./types.js";

export type EventPayload = Record<string, unknown>;

export function eventPayload(event: EventEnvelope): EventPayload {
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    throw new KnowledgeGraphContractError("projection_invalid", "그래프 투영 event payload가 유효하지 않습니다.");
  }
  return event.payload as EventPayload;
}

export function requiredText(payload: EventPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new KnowledgeGraphContractError("projection_invalid", `${key} 그래프 좌표가 유효하지 않습니다.`);
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
    throw new KnowledgeGraphContractError("projection_invalid", `${key} 그래프 좌표 묶음이 유효하지 않습니다.`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.length < 1 || item.length > 500) {
      throw new KnowledgeGraphContractError("projection_invalid", `${key} 그래프 좌표가 유효하지 않습니다.`);
    }
    return item;
  });
}

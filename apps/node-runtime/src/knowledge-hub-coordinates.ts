import type { NodeRuntimeConfig } from "./config-types.js";

/** Environment variable that hands the Node's Hub coordinates to its resident knowledge child. */
export const KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT = "LERVO_KNOWLEDGE_HUB_COORDINATES";

export type KnowledgeHubCoordinates = NodeRuntimeConfig["hub"];

/**
 * ADR-0469: the resident child derives its owner-host configuration from the Hub coordinates of
 * the Node that owns it. Only the coordinates cross the process boundary, never the token; the
 * child reads the owner-only token file itself.
 */
export function encodeKnowledgeHubCoordinates(hub: KnowledgeHubCoordinates): string {
  return JSON.stringify({
    baseUrl: hub.baseUrl,
    bearerTokenFile: hub.bearerTokenFile,
    destinationId: hub.destinationId,
    hubIdentityHash: hub.hubIdentityHash,
  });
}

/** Null when absent or malformed; the owner-host parser validates the values again. */
export function decodeKnowledgeHubCoordinates(
  value: string | undefined,
): KnowledgeHubCoordinates | null {
  if (value === undefined || value.length > 4_096) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Object.keys(parsed).length !== 4 ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.bearerTokenFile !== "string" ||
      typeof parsed.destinationId !== "string" ||
      typeof parsed.hubIdentityHash !== "string"
    )
      return null;
    return {
      baseUrl: parsed.baseUrl,
      bearerTokenFile: parsed.bearerTokenFile,
      destinationId: parsed.destinationId,
      hubIdentityHash: parsed.hubIdentityHash,
    };
  } catch {
    return null;
  }
}

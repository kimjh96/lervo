import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import { FileSystemCas } from "@lervo/cas";
import { assertConversationInboundEvent } from "@lervo/conversation-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ConversationInboundEvent } from "@lervo/schemas";

import type { BoundSupervisionRequest } from "./supervision-bound-request.js";
import { SQLiteConversationHistory } from "./conversation-history.js";

export interface VerifiedDiscordGoalRequester {
  status: "verified";
  ingressKind: "goal.requested" | "message.created";
  requesterKind: "human";
  sourceEventId: string;
  sourceEventKeyHash: string;
  contentHash: string;
}

function hasNaturalGoalIntent(path: string, event: ConversationInboundEvent): boolean {
  const database = openSqliteDatabase(path, {
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    readOnly: true,
    allowExtension: false,
  });
  try {
    const row = database
      .prepare(
        `SELECT message_hash, intent, confidence, participation, effect_json
           FROM conversation_intent_resolutions WHERE event_id = ?`,
      )
      .get(event.eventId) as Record<string, unknown> | undefined;
    if (row === undefined) return false;
    let effect: unknown;
    try {
      effect = JSON.parse(String(row.effect_json));
    } catch (error) {
      throw new Error("The Discord goal intent evidence is invalid.", { cause: error });
    }
    if (
      row.message_hash !== event.content.contentHash ||
      row.intent !== "continue_work" ||
      !["high", "medium"].includes(String(row.confidence)) ||
      row.participation !== "relevant" ||
      typeof effect !== "object" ||
      effect === null ||
      Array.isArray(effect) ||
      Object.keys(effect).length !== 1 ||
      (effect as { kind?: unknown }).kind !== "supervision_goal_request"
    )
      throw new Error("The Discord goal intent evidence is invalid.");
    return true;
  } finally {
    database.close();
  }
}

/** Reads native ingress; the bound origin actor is the outbound speaker. */
export async function readDiscordGoalRequesterProvenance(
  storage: ProjectStorage,
  request: BoundSupervisionRequest | null,
): Promise<VerifiedDiscordGoalRequester | null> {
  if (request?.source !== "discord" || request.origin?.actor.kind !== "agent") return null;
  const origin = request.origin;
  if (!/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.target.integrationId))
    throw new Error("The Discord request integration is invalid.");
  const path = resolve(
    storage.paths.data,
    "conversation",
    origin.target.integrationId,
    "interactions.sqlite",
  );
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("The Discord ingress store is unsafe.");
  const database = openSqliteDatabase(path, {
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    readOnly: true,
    allowExtension: false,
  });
  let row: Record<string, unknown> | undefined;
  try {
    row = database
      .prepare(
        "SELECT event_json, policy_id, integration_id, project_id, conversation_id, status FROM conversation_inbox WHERE event_id = ? AND role_id = ?",
      )
      .get(origin.sourceEventId, origin.actor.roleId) as Record<string, unknown> | undefined;
  } finally {
    database.close();
  }
  if (row === undefined) return null;
  if (typeof row.event_json !== "string" || Buffer.byteLength(row.event_json) > 65_536)
    throw new Error("The Discord ingress evidence is invalid.");
  let event: ConversationInboundEvent;
  try {
    event = JSON.parse(row.event_json) as ConversationInboundEvent;
    assertConversationInboundEvent(event);
  } catch (error) {
    throw new Error("The Discord ingress evidence is invalid.", { cause: error });
  }
  if (
    !["pending", "leased", "completed"].includes(String(row.status)) ||
    row.policy_id !== origin.policyId ||
    row.integration_id !== origin.target.integrationId ||
    row.project_id !== origin.target.projectId ||
    row.conversation_id !== origin.target.conversationId ||
    event.eventId !== origin.sourceEventId ||
    (event.kind !== "goal.requested" && event.kind !== "message.created") ||
    event.actor.kind !== "human" ||
    event.automationDepth !== 0 ||
    event.content.contentHash !== request.contentHash ||
    canonicalJson(event.target) !== canonicalJson(origin.target) ||
    (event.kind === "goal.requested" &&
      (!event.mentions.participantIds.includes(origin.actor.participantId) ||
        !event.mentions.roleIds.includes(origin.actor.roleId)))
  )
    throw new Error("The Discord ingress differs from its supervised request.");
  if (event.kind === "message.created") {
    const intentPath = resolve(
      storage.paths.data,
      "conversation",
      origin.target.integrationId,
      "intent-resolutions.sqlite",
    );
    let intentMetadata;
    try {
      intentMetadata = await lstat(intentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!intentMetadata.isFile() || intentMetadata.isSymbolicLink())
      throw new Error("The Discord goal intent store is unsafe.");
    if (!hasNaturalGoalIntent(intentPath, event)) return null;
  }
  if (request.conversationContext !== null && request.conversationContext.length > 0) {
    const artifactStore = await FileSystemCas.openReadOnly(
      resolve(storage.paths.data, "conversation", origin.target.integrationId, "artifacts"),
    );
    await new SQLiteConversationHistory(path, artifactStore).verifyEvidence(
      event,
      request.conversationContext,
    );
  }
  return {
    status: "verified",
    ingressKind: event.kind,
    requesterKind: "human",
    sourceEventId: event.eventId,
    sourceEventKeyHash: event.sourceEventKeyHash,
    contentHash: event.content.contentHash,
  };
}

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { assertConversationInboundEvent } from "@lervo/conversation-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ConversationInboundEvent } from "@lervo/schemas";

import type { BoundSupervisionRequest } from "./supervision-bound-request.js";

export interface VerifiedDiscordGoalRequester {
  status: "verified";
  ingressKind: "goal.requested";
  requesterKind: "human";
  sourceEventId: string;
  sourceEventKeyHash: string;
  contentHash: string;
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
  const database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
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
  } catch {
    throw new Error("The Discord ingress evidence is invalid.");
  }
  if (
    !["pending", "leased", "completed"].includes(String(row.status)) ||
    row.policy_id !== origin.policyId ||
    row.integration_id !== origin.target.integrationId ||
    row.project_id !== origin.target.projectId ||
    row.conversation_id !== origin.target.conversationId ||
    event.eventId !== origin.sourceEventId ||
    event.kind !== "goal.requested" ||
    event.actor.kind !== "human" ||
    event.automationDepth !== 0 ||
    event.content.contentHash !== request.contentHash ||
    canonicalJson(event.target) !== canonicalJson(origin.target) ||
    !event.mentions.participantIds.includes(origin.actor.participantId) ||
    !event.mentions.roleIds.includes(origin.actor.roleId)
  )
    throw new Error("The Discord ingress differs from its supervised request.");
  return {
    status: "verified",
    ingressKind: "goal.requested",
    requesterKind: "human",
    sourceEventId: event.eventId,
    sourceEventKeyHash: event.sourceEventKeyHash,
    contentHash: event.content.contentHash,
  };
}

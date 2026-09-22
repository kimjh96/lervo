import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { verifyDiscordDeliveryEvidence } from "./discord-delivery-reconciliation-evidence.mjs";

async function existingDatabase(path) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Delivery reconciliation requires existing real stores.");
  }
  const database = new DatabaseSync(path, {
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  database.exec("PRAGMA query_only = ON;");
  return database;
}

async function inspectStoredDelivery(dataDirectory, integrationId, outboundId) {
  const interactions = await existingDatabase(resolve(dataDirectory, "interactions.sqlite"));
  const platform = await existingDatabase(resolve(dataDirectory, "platform.sqlite"));
  try {
    const row = interactions
      .prepare(
        "SELECT outbound_json, status, attempt_count, last_failure_code FROM conversation_outbox WHERE outbound_id = ? AND integration_id = ?",
      )
      .get(outboundId, integrationId);
    if (row === undefined) throw new Error("The exact outbound is not present.");
    const outbound = JSON.parse(row.outbound_json);
    if (outbound.outboundId !== outboundId || outbound.target?.integrationId !== integrationId) {
      throw new Error("The durable outbound coordinates differ.");
    }
    const address = platform
      .prepare(
        `SELECT tenant_key, conversation_key FROM conversation_bindings
         WHERE platform = 'discord' AND integration_id = ? AND project_id = ?
           AND conversation_id = ?`,
      )
      .get(integrationId, outbound.target.projectId, outbound.target.conversationId);
    if (address === undefined) throw new Error("The outbound address is not bound.");
    const thread =
      outbound.target.threadId === null
        ? null
        : platform
            .prepare(
              `SELECT thread_key FROM thread_bindings
               WHERE platform = 'discord' AND integration_id = ? AND thread_id = ?`,
            )
            .get(integrationId, outbound.target.threadId);
    if (outbound.target.threadId !== null && thread === undefined) {
      throw new Error("The outbound thread is not bound.");
    }
    const reply = platform
      .prepare(
        `SELECT external_message_key FROM message_correlations
         WHERE platform = 'discord' AND integration_id = ? AND tenant_key = ?
           AND conversation_key = ? AND observed_event_id = ?`,
      )
      .get(
        integrationId,
        address.tenant_key,
        address.conversation_key,
        outbound.replyToEventId ?? outbound.sourceEventId,
      );
    const replay = platform
      .prepare(
        `SELECT status, request_hash, external_message_key, delivered_at
         FROM delivery_replay WHERE platform = 'discord' AND integration_id = ? AND outbound_id = ?`,
      )
      .get(integrationId, outboundId);
    if (replay === undefined || replay.status === "rejected") {
      throw new Error("The delivery replay cannot be reconciled as delivered.");
    }
    return {
      outbound,
      status: row.status,
      attemptCount: row.attempt_count,
      failureCode: row.last_failure_code,
      tenantKey: address.tenant_key,
      conversationKey: address.conversation_key,
      channelId: thread?.thread_key ?? address.conversation_key,
      sourceExternalMessageId: reply?.external_message_key ?? null,
      replay,
    };
  } finally {
    interactions.close();
    platform.close();
  }
}

function speakerFor(deployment, conversationKey) {
  if (deployment.speaker?.kind === "bot") {
    return { kind: "bot", applicationId: deployment.applicationId };
  }
  if (deployment.speaker?.kind === "webhook") {
    const webhook = deployment.speaker.webhooks?.find((item) => item.channelId === conversationKey);
    if (webhook !== undefined) return { kind: "webhook", webhookId: webhook.webhookId };
  }
  throw new Error("The installed speaker is not bound to the outbound conversation.");
}

export function configuredDiscordDeployment(config, integrationId) {
  if (config.discordConversation !== undefined && config.discordConversations !== undefined) {
    throw new Error("Use either discordConversation or discordConversations, not both.");
  }
  const deployments =
    config.discordConversations ??
    (config.discordConversation === undefined ? [] : [config.discordConversation]);
  return deployments.find((item) => item.integrationId === integrationId);
}

export async function reconcileDiscordDelivery({
  configPath,
  integrationId,
  outboundId,
  messageId,
  apply = false,
  fetchMessage = globalThis.fetch,
}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const deployment = configuredDiscordDeployment(config, integrationId);
  if (deployment === undefined || !/^[0-9]{1,32}$/.test(messageId)) {
    throw new Error("The Discord delivery target is not configured.");
  }
  if (
    !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(integrationId) ||
    !/^cvo_[a-f0-9]{64}$/.test(outboundId)
  ) {
    throw new Error("The delivery identifiers are invalid.");
  }
  const dataDirectory = resolve(config.repositoryRoot, ".lervo/data/conversation", integrationId);
  const directory = await lstat(dataDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("The configured conversation store is not a real directory.");
  }
  const stored = await inspectStoredDelivery(dataDirectory, integrationId, outboundId);
  const token = (await readFile(deployment.botTokenFile, "utf8")).trim();
  const response = await fetchMessage(
    `https://discord.com/api/v10/channels/${stored.channelId}/messages/${messageId}`,
    { headers: { authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error("The Discord message cannot be observed.");
  const evidence = verifyDiscordDeliveryEvidence({
    message: await response.json(),
    messageId,
    channelId: stored.channelId,
    sourceExternalMessageId: stored.sourceExternalMessageId,
    outbound: stored.outbound,
    speaker: speakerFor(deployment, stored.conversationKey),
  });
  if (
    stored.replay.status === "delivered" &&
    (stored.replay.external_message_key !== messageId ||
      stored.replay.delivered_at !== evidence.deliveredAt)
  ) {
    throw new Error("The replay receipt conflicts with the observed message.");
  }
  if (stored.status !== "attention_required" && stored.status !== "delivered") {
    throw new Error("The outbound has not reached a reconcilable state.");
  }
  if (stored.status === "delivered" && stored.replay.status !== "delivered") {
    throw new Error("The outbox and replay delivery states differ.");
  }
  const result = {
    disposition: stored.status === "delivered" ? "already_delivered" : "ready_to_reconcile",
    outboundId,
    integrationId,
    externalMessageKey: messageId,
    contentHash: evidence.contentHash,
    attemptCount: stored.attemptCount,
    failureCode: stored.failureCode,
  };
  if (!apply || stored.status === "delivered") return result;
  const current = await inspectStoredDelivery(dataDirectory, integrationId, outboundId);
  if (
    current.status !== stored.status ||
    current.attemptCount !== stored.attemptCount ||
    current.failureCode !== stored.failureCode ||
    current.replay.request_hash !== stored.replay.request_hash ||
    current.outbound.content.contentHash !== stored.outbound.content.contentHash
  ) {
    throw new Error("The delivery changed during reconciliation.");
  }
  const { SQLiteConversationPlatformStore } =
    await import("../../../packages/conversation-platform-sqlite/dist/index.js");
  const platform = await SQLiteConversationPlatformStore.openForDeliveryReconciliation(
    resolve(dataDirectory, "platform.sqlite"),
  );
  try {
    await platform.reconcileDelivered({
      platform: "discord",
      integrationId,
      outboundId,
      requestHash: stored.replay.request_hash,
      externalMessageKey: messageId,
      deliveredAt: evidence.deliveredAt,
    });
    await platform.recordOutbound({
      platform: "discord",
      integrationId,
      tenantKey: stored.tenantKey,
      conversationKey: stored.conversationKey,
      externalMessageKey: messageId,
      outboundId,
      sourceEventId: stored.outbound.sourceEventId,
      automationDepth: stored.outbound.automationDepth,
    });
  } finally {
    platform.close();
  }
  const { SQLiteConversationInteractionStore } =
    await import("../../../packages/interaction-sqlite/dist/index.js");
  const interactions = await SQLiteConversationInteractionStore.open({
    path: resolve(dataDirectory, "interactions.sqlite"),
  });
  try {
    await interactions.acknowledgeReconciledOutbound({
      outboundId,
      expectedAttemptCount: stored.attemptCount,
      expectedFailureCode: stored.failureCode,
      receipt: {
        schemaVersion: 1,
        outboundId,
        integrationId,
        deliveryKeyHash: `sha256:${createHash("sha256").update(messageId).digest("hex")}`,
        deliveredAt: evidence.deliveredAt,
      },
    });
  } finally {
    await interactions.close();
  }
  return { ...result, disposition: "reconciled" };
}

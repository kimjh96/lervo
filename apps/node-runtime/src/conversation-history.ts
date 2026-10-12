import { createHash } from "node:crypto";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import { canonicalJson } from "@lervo/event-contract";
import { validateSchema, type ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { ConversationContextTurn } from "@lervo/conversation-responder";

export interface ConversationHistoryPort {
  recent(event: ConversationInboundEvent): Promise<ConversationContextTurn[]>;
}

export interface ConversationHistoryEvidencePort {
  recentEvidence(event: ConversationInboundEvent): Promise<ConversationHistoryEvidenceTurn[]>;
}

export interface ConversationHistoryEvidenceTurn extends ConversationContextTurn {
  source: {
    kind: "inbound" | "outbound";
    id: string;
    roleId: string;
    recordHash: string;
    contentHash: string;
    observedAtMs: number;
  };
}

interface HistoryRow {
  record_json: string;
  role: "user" | "assistant";
  source_id: string;
  source_role_id: string;
  observed_at_ms: number;
}

interface StoredTurn {
  role: "user" | "assistant";
  occurredAt: string;
  content: { contentHash: string; byteCount: number };
  target: ConversationInboundEvent["target"];
  speaker: ConversationContextTurn["speaker"];
}

function decodeTurn(value: string, role: StoredTurn["role"]): StoredTurn {
  const record = JSON.parse(value) as Record<string, unknown>;
  const schema = role === "user" ? "conversationInboundEvent" : "conversationOutboundMessage";
  if (!validateSchema(schema, record).valid) {
    throw new Error("The stored conversation history record is invalid.");
  }
  return {
    role,
    occurredAt: (role === "user" ? record.occurredAt : record.createdAt) as string,
    content: record.content as StoredTurn["content"],
    target: record.target as ConversationInboundEvent["target"],
    speaker: {
      kind: (record.actor as { kind: ConversationContextTurn["speaker"]["kind"] }).kind,
      participantId: (record.actor as { participantId: string }).participantId,
      agentId:
        (record.actor as { agentBinding?: { agentId?: string } }).agentBinding?.agentId ?? null,
      roleId: (record.actor as { roleId: string | null }).roleId,
    },
  };
}

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function sourceFor(
  row: HistoryRow,
  contentHash: string,
): ConversationHistoryEvidenceTurn["source"] {
  return {
    kind: row.role === "user" ? "inbound" : "outbound",
    id: row.source_id,
    roleId: row.source_role_id,
    recordHash: digest(row.record_json),
    contentHash,
    observedAtMs: row.observed_at_ms,
  };
}

async function verifiedText(artifacts: ArtifactStore, turn: StoredTurn): Promise<string> {
  const uri = `lervo-cas://sha256/${turn.content.contentHash.slice("sha256:".length)}`;
  const bytes = new Uint8Array(await artifacts.get(uri));
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== turn.content.byteCount || contentHash !== turn.content.contentHash) {
    throw new Error("The stored conversation history artifact differs from its reference.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 2_048);
}

export class SQLiteConversationHistory implements ConversationHistoryPort {
  constructor(
    private readonly path: string,
    private readonly artifacts: ArtifactStore,
  ) {}

  async recent(event: ConversationInboundEvent): Promise<ConversationContextTurn[]> {
    return (await this.recentEvidence(event)).map(({ role, text, speaker }) => ({
      role,
      text,
      speaker,
    }));
  }

  /** Captures only turns observed and delivered before this exact ingress event. */
  async recentEvidence(
    event: ConversationInboundEvent,
  ): Promise<ConversationHistoryEvidenceTurn[]> {
    const cutoff = Date.parse(event.occurredAt);
    if (!Number.isSafeInteger(cutoff)) throw new Error("The conversation event time is invalid.");
    const database = openSqliteDatabase(this.path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      readOnly: true,
      allowExtension: false,
    });
    try {
      const rows = database
        .prepare(
          `
            SELECT record_json, role, source_id, source_role_id, observed_at_ms FROM (
              SELECT event_json AS record_json, 'user' AS role, conversation_inbox.event_id AS source_id,
                conversation_inbox.role_id AS source_role_id, decided_at_ms AS observed_at_ms,
                unixepoch(json_extract(conversation_inbox.event_json, '$.occurredAt'), 'subsec') * 1000 AS source_occurred_ms
              FROM conversation_inbox
              JOIN conversation_participation_decisions USING (event_id, role_id)
              WHERE conversation_inbox.status = 'completed'
                AND conversation_inbox.project_id = ? AND conversation_inbox.conversation_id = ?
                AND unixepoch(json_extract(conversation_inbox.event_json, '$.occurredAt'), 'subsec') * 1000 < ?
                AND json_extract(conversation_inbox.event_json, '$.target.threadId') IS ?
              UNION ALL
              SELECT outbound_json AS record_json, 'assistant' AS role,
                outbound_id AS source_id, role_id AS source_role_id,
                delivered_at_ms AS observed_at_ms,
                unixepoch(json_extract(outbound_json, '$.createdAt'), 'subsec') * 1000 AS source_occurred_ms
              FROM conversation_outbox
              WHERE status = 'delivered' AND project_id = ? AND conversation_id = ?
                AND delivered_at_ms < ?
                AND unixepoch(json_extract(outbound_json, '$.createdAt'), 'subsec') * 1000 < ?
                AND json_extract(outbound_json, '$.target.threadId') IS ?
            ) ORDER BY source_occurred_ms DESC, source_id DESC, source_role_id DESC LIMIT 64
          `,
        )
        .all(
          event.target.projectId,
          event.target.conversationId,
          cutoff,
          event.target.threadId,
          event.target.projectId,
          event.target.conversationId,
          cutoff,
          cutoff,
          event.target.threadId,
        ) as unknown as HistoryRow[];
      const matchingTurns = rows
        .map((row) => ({ row, turn: decodeTurn(row.record_json, row.role) }))
        .filter(
          ({ turn }) =>
            turn.target.threadId === event.target.threadId && Date.parse(turn.occurredAt) < cutoff,
        )
        .sort(
          (left, right) =>
            Date.parse(left.turn.occurredAt) - Date.parse(right.turn.occurredAt) ||
            left.row.source_id.localeCompare(right.row.source_id) ||
            left.row.source_role_id.localeCompare(right.row.source_role_id),
        );
      const selected = new Set([
        ...matchingTurns.slice(-8),
        ...matchingTurns.filter(({ turn }) => turn.speaker.kind === "human").slice(-4),
      ]);
      const turns = matchingTurns.filter((turn) => selected.has(turn));
      return await Promise.all(
        turns.map(async ({ row, turn }) => ({
          role: turn.role,
          text: await verifiedText(this.artifacts, turn),
          speaker: turn.speaker,
          source: sourceFor(row, turn.content.contentHash),
        })),
      );
    } finally {
      database.close();
    }
  }

  /** Rechecks each immutable source row and its CAS bytes before owner reasoning uses a snapshot. */
  async verifyEvidence(
    event: ConversationInboundEvent,
    turns: readonly ConversationHistoryEvidenceTurn[],
  ): Promise<void> {
    const cutoff = Date.parse(event.occurredAt);
    if (!Number.isSafeInteger(cutoff)) throw new Error("The conversation event time is invalid.");
    const database = openSqliteDatabase(this.path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      readOnly: true,
      allowExtension: false,
    });
    try {
      for (const evidence of turns) {
        const row =
          evidence.source.kind === "inbound"
            ? (database
                .prepare(
                  `SELECT event_json AS record_json, 'user' AS role, event_id AS source_id,
                    role_id AS source_role_id, decided_at_ms AS observed_at_ms
                   FROM conversation_inbox
                   JOIN conversation_participation_decisions USING (event_id, role_id)
                   WHERE event_id = ? AND role_id = ? AND status = 'completed'`,
                )
                .get(evidence.source.id, evidence.source.roleId) as HistoryRow | undefined)
            : (database
                .prepare(
                  `SELECT outbound_json AS record_json, 'assistant' AS role,
                    outbound_id AS source_id, role_id AS source_role_id,
                    delivered_at_ms AS observed_at_ms
                   FROM conversation_outbox
                   WHERE outbound_id = ? AND role_id = ? AND status = 'delivered'`,
                )
                .get(evidence.source.id, evidence.source.roleId) as HistoryRow | undefined);
        if (row === undefined) throw new Error("A bound conversation context source is missing.");
        const turn = decodeTurn(row.record_json, row.role);
        if (
          (evidence.source.kind === "outbound" && row.observed_at_ms >= cutoff) ||
          Date.parse(turn.occurredAt) >= cutoff
        )
          throw new Error("A bound conversation context turn was not prior to ingress.");
        if (canonicalJson(turn.target) !== canonicalJson(event.target))
          throw new Error("A bound conversation context turn belongs to another target.");
        if (
          canonicalJson(sourceFor(row, turn.content.contentHash)) !== canonicalJson(evidence.source)
        )
          throw new Error("A bound conversation context source reference differs.");
        if (
          evidence.role !== turn.role ||
          canonicalJson(evidence.speaker) !== canonicalJson(turn.speaker) ||
          evidence.text !== (await verifiedText(this.artifacts, turn))
        )
          throw new Error("A bound conversation context turn differs from its exact source.");
      }
    } finally {
      database.close();
    }
  }
}

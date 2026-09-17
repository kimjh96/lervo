import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { validateSchema, type ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { ConversationContextTurn } from "@lervo/conversation-responder";

export interface ConversationHistoryPort {
  recent(event: ConversationInboundEvent): Promise<ConversationContextTurn[]>;
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
    const database = new DatabaseSync(this.path, { readOnly: true, allowExtension: false });
    try {
      const rows = database
        .prepare(
          `
            SELECT record_json, role FROM (
              SELECT event_json AS record_json, 'user' AS role, decided_at_ms AS occurred_at_ms
              FROM conversation_inbox
              JOIN conversation_participation_decisions USING (event_id, role_id)
              WHERE conversation_inbox.status = 'completed'
                AND conversation_inbox.project_id = ? AND conversation_inbox.conversation_id = ?
              UNION ALL
              SELECT outbound_json AS record_json, 'assistant' AS role,
                available_at_ms AS occurred_at_ms
              FROM conversation_outbox
              WHERE project_id = ? AND conversation_id = ?
            ) ORDER BY occurred_at_ms DESC LIMIT 64
          `,
        )
        .all(
          event.target.projectId,
          event.target.conversationId,
          event.target.projectId,
          event.target.conversationId,
        ) as Array<{ record_json: string; role: "user" | "assistant" }>;
      const matchingTurns = rows
        .map((row) => decodeTurn(row.record_json, row.role))
        .filter((turn) => turn.target.threadId === event.target.threadId)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      const selected = new Set([
        ...matchingTurns.slice(-8),
        ...matchingTurns.filter((turn) => turn.speaker.kind === "human").slice(-4),
      ]);
      const turns = matchingTurns.filter((turn) => selected.has(turn));
      return await Promise.all(
        turns.map(async (turn) => ({
          role: turn.role,
          text: await verifiedText(this.artifacts, turn),
          speaker: turn.speaker,
        })),
      );
    } finally {
      database.close();
    }
  }
}

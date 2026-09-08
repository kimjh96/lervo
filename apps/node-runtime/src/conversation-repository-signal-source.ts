import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationInboundEvent, EventEnvelope } from "@lervo/schemas";

interface RepositorySignalMapping {
  eventType: string;
  signalCode: string;
  conversationIds?: readonly string[];
}

export class RepositoryConversationSignalSource {
  private afterSeq: number | null = null;

  constructor(
    private readonly options: {
      projectId: string;
      integrationId: string;
      conversationIds: readonly string[];
      mappings: readonly RepositorySignalMapping[];
      events: Pick<EventStore, "latest" | "list">;
      artifacts: ArtifactStore;
      cursor: {
        read(): Promise<number | null>;
        write(afterSeq: number, at: string): Promise<void>;
      };
      dispatch(event: ConversationInboundEvent): Promise<void>;
      now?(): Date;
    },
  ) {}

  async initialize(): Promise<void> {
    if (this.afterSeq !== null) return;
    const persisted = await this.options.cursor.read();
    const latestSeq = this.options.events.latest()?.seq ?? 0;
    if (persisted !== null && persisted > latestSeq) {
      throw new Error("The conversation repository signal cursor exceeds the event head.");
    }
    this.afterSeq = persisted ?? latestSeq;
    if (persisted === null) await this.persist(this.afterSeq);
  }

  async runCycle(): Promise<{ status: "idle" | "processed"; eventCount: number }> {
    await this.initialize();
    const events = this.options.events.list({ afterSeq: this.afterSeq!, limit: 100 });
    for (const event of events) {
      await this.dispatchMappings(event);
      this.afterSeq = event.seq;
      await this.persist(event.seq);
    }
    return { status: events.length === 0 ? "idle" : "processed", eventCount: events.length };
  }

  private async dispatchMappings(source: EventEnvelope): Promise<void> {
    for (const mapping of this.options.mappings.filter((item) => item.eventType === source.type)) {
      const conversationIds = mapping.conversationIds ?? this.options.conversationIds;
      for (const conversationId of conversationIds) {
        const body = `Repository signal ${mapping.signalCode} was raised after ${source.type}. Review current canonical repository state and contribute only if useful.`;
        const artifact = await this.options.artifacts.put(body);
        await this.options.dispatch(
          createConversationInboundEvent({
            sourceEventKeyHash: hashConversationSourceEventKey(
              `repository:${source.eventId}:${mapping.signalCode}:${conversationId}`,
            ),
            target: {
              integrationId: this.options.integrationId,
              projectId: this.options.projectId,
              conversationId,
              threadId: null,
            },
            kind: "signal.raised",
            actor: {
              kind: "system",
              participantId: "ptc_lervo_system",
              roleId: null,
              agentBinding: null,
            },
            content: {
              artifactId: `art_${artifact.contentHash.slice("sha256:".length, 60)}`,
              contentHash: artifact.contentHash,
              byteCount: artifact.byteCount,
              mediaType: "text/plain; charset=utf-8",
            },
            mentions: { roleIds: [], participantIds: [] },
            replyToEventId: null,
            signalCode: mapping.signalCode,
            automationDepth: 0,
            occurredAt: source.occurredAt,
          }),
        );
      }
    }
  }

  private persist(afterSeq: number): Promise<void> {
    return this.options.cursor.write(afterSeq, (this.options.now?.() ?? new Date()).toISOString());
  }
}

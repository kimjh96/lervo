import { createHash } from "node:crypto";

import type { ConversationApplication } from "@lervo/conversation-app";
import { projectAgentOrganizationFromEventSource } from "@lervo/agent-organization";
import { readDeliberationArtifactEvents } from "@lervo/deliberation";
import type { DeliberationArtifact, EventEnvelope } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

async function verifiedArtifactContent(
  artifacts: ArtifactStore,
  artifact: DeliberationArtifact,
): Promise<string> {
  const bytes = new Uint8Array(await artifacts.get(artifact.content.uri));
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== artifact.content.byteCount || hash !== artifact.content.contentHash) {
    throw new Error("The deliberation artifact body differs from its recorded coordinates.");
  }
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  if (content.length === 0) {
    throw new Error("The deliberation artifact body is empty.");
  }
  return content;
}

export class ConversationDeliberationArtifactSource {
  private afterSeq: number | null = null;
  private application: ConversationApplication | null = null;
  private more = false;

  constructor(
    private readonly options: {
      projectId: string;
      integrationId: string;
      events: Pick<EventStore, "latest" | "list">;
      repositoryArtifacts: ArtifactStore;
      conversationArtifacts: ArtifactStore;
      cursor: {
        read(): Promise<number | null>;
        write(afterSeq: number, at: string): Promise<void>;
      };
      participantPublisher?: {
        publish(input: {
          participantId: string;
          projectId: string;
          conversationId: string;
          threadId: string | null;
          replyToEventId: string;
          artifactEventId: string;
          content: string;
          occurredAt: string;
        }): Promise<void>;
      };
      now?(): Date;
    },
  ) {}

  get hasMore(): boolean {
    return this.more;
  }

  async initialize(): Promise<void> {
    if (this.afterSeq !== null) return;
    const persisted = await this.options.cursor.read();
    const latestSeq = this.options.events.latest()?.seq ?? 0;
    if (persisted !== null && persisted > latestSeq) {
      throw new Error("The conversation deliberation artifact cursor exceeds the event head.");
    }
    this.afterSeq = persisted ?? latestSeq;
    if (persisted === null) await this.persist(this.afterSeq);
  }

  attach(application: ConversationApplication): void {
    if (this.application !== null) {
      throw new Error("The conversation deliberation artifact source is already attached.");
    }
    this.application = application;
  }

  async runCycle(): Promise<{ eventCount: number; publicationCount: number }> {
    await this.initialize();
    const events = this.options.events.list({ afterSeq: this.afterSeq!, limit: 100 });
    let publicationCount = 0;
    let localPublicationCount = 0;
    for (const event of events) {
      if (event.type === "deliberation.artifact.recorded") {
        const publication = await this.publish(event);
        if (publication !== "none") publicationCount += 1;
        if (publication === "local") localPublicationCount += 1;
      }
      this.afterSeq = event.seq;
      await this.persist(event.seq);
    }
    this.more = events.length === 100;
    if (localPublicationCount > 0) {
      await this.application!.runDeliveryCycle!(this.options.integrationId);
    }
    return { eventCount: events.length, publicationCount };
  }

  private async publish(event: EventEnvelope): Promise<"none" | "local" | "routed"> {
    if (
      this.application === null ||
      this.application.handleInboundEvent === null ||
      this.application.runDeliveryCycle === null
    ) {
      throw new Error("The deliberation artifact interaction runtime is unavailable.");
    }
    const validation = validateSchema("deliberationArtifactRecordedEventPayload", event.payload);
    if (!validation.valid || typeof event.payload.deliberationId !== "string") {
      throw new Error("The deliberation artifact event payload is invalid.");
    }
    const source = readDeliberationArtifactEvents({
      deliberationId: event.payload.deliberationId,
      events: [event],
    });
    if (source.status !== "complete" || source.artifacts.length !== 1) {
      throw new Error("The deliberation artifact event is not a complete projection source.");
    }
    const artifact = source.artifacts[0]!;
    if (artifact.projectId !== this.options.projectId) {
      throw new Error("The deliberation artifact project differs from the conversation project.");
    }
    const origin = await this.application.inspectDeliberationOrigin({
      projectId: this.options.projectId,
      deliberationId: artifact.deliberationId,
    });
    if (origin === null) return "none";

    const organization = projectAgentOrganizationFromEventSource({
      projectId: this.options.projectId,
      events: this.options.events,
    });
    const participantBindings = organization.deliberationParticipants.filter(
      (binding) =>
        binding.deliberationId === artifact.deliberationId &&
        binding.policyRoleId === artifact.producer.roleId &&
        binding.bindingVersion === 2,
    );
    if (participantBindings.length > 1) {
      throw new Error("The deliberation artifact has multiple named participant bindings.");
    }
    const participant = participantBindings[0];
    if (participant === undefined) {
      // Policy-only seats are internal review coverage, not synthetic conversation speakers.
      return "none";
    }
    if (this.options.participantPublisher === undefined) {
      throw new Error("The named deliberation participant publication route is unavailable.");
    }
    await this.options.participantPublisher.publish({
      participantId: participant.participantId,
      projectId: this.options.projectId,
      conversationId: origin.conversationId,
      threadId: origin.threadId,
      replyToEventId: origin.sourceEventId,
      artifactEventId: event.eventId,
      content: await verifiedArtifactContent(this.options.repositoryArtifacts, artifact),
      occurredAt: event.occurredAt,
    });
    return "routed";
  }

  private persist(afterSeq: number): Promise<void> {
    return this.options.cursor.write(afterSeq, (this.options.now?.() ?? new Date()).toISOString());
  }
}

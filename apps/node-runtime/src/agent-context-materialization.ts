import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  agentOrganizationEventTypes,
  isAgentContextEventType,
  projectAgentContext,
  projectAgentOrganization,
  type AgentContextEventEnvelope,
} from "@lervo/agent-organization";
import { listAgents } from "@lervo/agent-workforce";
import { documentIdForPath, type ContextDocumentCandidate } from "@lervo/context";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { renderAgentContextDocument, selectAgentContextEntries } from "./agent-context-document.js";

const maximumEntries = 8;
const retainedEventTypes = [
  "agent.context.promoted",
  "agent.context.handoff.recorded",
  ...agentOrganizationEventTypes,
];
const maximumMaterializedBytes = 32_768;

function artifactUri(contentHash: string): string {
  return `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
}

async function verifiedSummary(
  artifacts: ArtifactStore,
  entry: { summaryContentHash: string; summaryByteCount: number },
): Promise<string> {
  const bytes = new Uint8Array(await artifacts.get(artifactUri(entry.summaryContentHash)));
  const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== entry.summaryByteCount || actualHash !== entry.summaryContentHash) {
    throw new Error("An agent-context summary differs from its canonical artifact reference.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export class AgentContextMaterializer {
  private events: EventEnvelope[] = [];
  private lastSequence = 0;

  constructor(
    private readonly options: {
      repositoryRoot: string;
      projectId: string;
      dataDirectory: string;
      events: EventStore;
      artifacts: ArtifactStore;
    },
  ) {}

  /**
   * ADR-0554: only the agent-context and organization events the projections read are retained.
   * Review and source events they reference are looked up by ID, within the observed head.
   */
  private refreshEvents(): void {
    const head = this.options.events.latest()?.seq ?? 0;
    while (this.lastSequence < head) {
      const page = this.options.events
        .list({ afterSeq: this.lastSequence, limit: 1_000, types: retainedEventTypes })
        .filter((event) => event.seq <= head);
      this.events.push(...page);
      if (page.length < 1_000) break;
      this.lastSequence = page.at(-1)!.seq;
    }
    this.lastSequence = head;
  }

  private lookupEvent(eventId: string): AgentContextEventEnvelope | undefined {
    const event = this.options.events.get(eventId);
    return event !== null && event.seq <= this.lastSequence
      ? (event as AgentContextEventEnvelope)
      : undefined;
  }

  async materialize(
    agentId: string,
    retrieval: { query: string; observedAt: Date },
  ): Promise<ContextDocumentCandidate> {
    this.refreshEvents();
    const agents = await listAgents(this.options.repositoryRoot);
    const context = projectAgentContext({
      projectId: this.options.projectId,
      agentId,
      agents,
      events: this.events.filter((event) =>
        isAgentContextEventType(event.type),
      ) as AgentContextEventEnvelope[],
      lookupEvent: (eventId) => this.lookupEvent(eventId),
      observedThroughSeq: this.lastSequence,
    });
    const organization = projectAgentOrganization({
      projectId: this.options.projectId,
      events: this.events.filter((event) => event.type.startsWith("organization.")),
    });
    const selected = selectAgentContextEntries(context, maximumEntries, {
      query: retrieval.query,
      at: retrieval.observedAt,
    });
    const entries = await Promise.all(
      selected.map(async (entry) => ({
        contextEntryId: entry.contextEntryId,
        ownerAgentId: entry.agentId,
        layer: entry.layer,
        memoryKind: entry.memoryKind,
        subjectKey: entry.subjectKey,
        confidence: entry.confidence,
        observedAt: entry.observedAt,
        expiresAt: entry.expiresAt,
        source: entry.source,
        promotedAt: entry.promotedAt,
        summary: await verifiedSummary(this.options.artifacts, entry),
      })),
    );
    const content = renderAgentContextDocument({ context, organization, entries });
    if (Buffer.byteLength(content) > maximumMaterializedBytes) {
      throw new Error("The bounded agent-context projection exceeds its materialization limit.");
    }
    const directory = resolve(this.options.dataDirectory, "agent-context");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const absolutePath = resolve(directory, `${agentId}.json`);
    const temporary = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, absolutePath);
    const path = relative(this.options.repositoryRoot, absolutePath).split(sep).join("/");
    if (path.startsWith("../") || path === "..") {
      throw new Error("The agent-context projection directory is outside the repository.");
    }
    return {
      documentId: documentIdForPath(path),
      path,
      connectedPaths: [],
      source: "agent_context",
      documentRole: "governance_context",
      referenceEligible: false,
    };
  }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  projectAgentContext,
  projectAgentOrganization,
  type AgentContextEventEnvelope,
} from "@lervo/agent-organization";
import { listAgents } from "@lervo/agent-workforce";
import { documentIdForPath, type ContextDocumentCandidate } from "@lervo/context";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { renderAgentContextDocument, selectAgentContextEntries } from "./agent-context-document.js";

const maximumEntries = 32;
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

  private refreshEvents(): void {
    while (true) {
      const page = this.options.events.list({ afterSeq: this.lastSequence, limit: 1_000 });
      this.events.push(...page);
      if (page.length === 0) return;
      this.lastSequence = page.at(-1)!.seq;
      if (page.length < 1_000) return;
    }
  }

  async materialize(agentId: string): Promise<ContextDocumentCandidate> {
    this.refreshEvents();
    const agents = await listAgents(this.options.repositoryRoot);
    const context = projectAgentContext({
      projectId: this.options.projectId,
      agentId,
      agents,
      events: this.events as AgentContextEventEnvelope[],
    });
    const organization = projectAgentOrganization({
      projectId: this.options.projectId,
      events: this.events.filter((event) => event.type.startsWith("organization.")),
    });
    const selected = selectAgentContextEntries(context, maximumEntries);
    const entries = await Promise.all(
      selected.map(async (entry) => ({
        contextEntryId: entry.contextEntryId,
        ownerAgentId: entry.agentId,
        layer: entry.layer,
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

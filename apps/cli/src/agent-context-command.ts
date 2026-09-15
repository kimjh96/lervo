import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  organizationIdentityHash,
  agentContextReviewAttests,
  projectAgentContextFromEventSource,
} from "@lervo/agent-organization";
import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type {
  AgentContextHandoffRecordedEventPayload,
  AgentContextPromotedEventPayload,
} from "@lervo/schemas";

import { mutateAgentOrganization } from "./agent-organization-mutation.js";
import type { CliIo } from "./types.js";

export const agentContextUsage = [
  "  lervo agent context inspect --agent <agent-id> [--root <path>] [--json]",
  "  lervo agent context promote --agent <agent-id> --layer <work|relationship|expertise> --kind <memory-kind> --subject <key> --retrieval-term <term> --source-kind <event|artifact> --source-id <id> --source-hash <sha256> --review-event <event-id> --summary-stdin [--confidence <medium|high>] [--sensitivity <internal|restricted>] [--observed-at <time>] [--expires-at <time>] [--supersedes <entry-id>] --write [--root <path>] [--json]",
  "  lervo agent context handoff --from-agent <id> --to-agent <id> --entry <context-entry-id> --write [--root <path>] [--json]",
].join("\n");

function artifactId(contentHash: string): string {
  return `art_${contentHash.slice("sha256:".length)}`;
}

function coordinate(prefix: "actx" | "ach", value: unknown): string {
  const start = "sha256:".length;
  return `${prefix}_${organizationIdentityHash(value).slice(start, start + 24)}`;
}

function appendContextEvent(
  storage: ProjectStorage,
  type: "agent.context.promoted" | "agent.context.handoff.recorded",
  payload: AgentContextPromotedEventPayload | AgentContextHandoffRecordedEventPayload,
): void {
  const identity = organizationIdentityHash({ type, payload }).slice("sha256:".length, 40);
  const draft = {
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type,
    occurredAt: "promotedAt" in payload ? payload.promotedAt : payload.recordedAt,
    actor: { kind: "system" as const },
    policyVersion: organizationIdentityHash({ contract: "agent-context", version: 1 }),
    payload,
  };
  storage.events.append(
    (storage.writableEventSchemaVersion ?? 1) >= 2
      ? { ...draft, schemaVersion: 2 }
      : { ...draft, schemaVersion: 1 },
  );
}

function activeAgent(agents: readonly WorkforceAgent[], agentId: string): WorkforceAgent {
  const agent = agents.find((candidate) => candidate.agentId === agentId);
  if (agent === undefined || agent.status !== "active") {
    throw new Error("Agent context mutation requires an active hired agent.");
  }
  return agent;
}

function projection(storage: ProjectStorage, agents: readonly WorkforceAgent[], agentId: string) {
  return projectAgentContextFromEventSource({
    projectId: storage.manifest.projectId,
    agentId,
    agents,
    events: storage.events,
  });
}

function output(io: CliIo, value: unknown, json: boolean | undefined, message: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
}

export async function runAgentContextCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      write: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      agent: { type: "string" },
      layer: { type: "string" },
      kind: { type: "string" },
      subject: { type: "string" },
      "retrieval-term": { type: "string", multiple: true },
      confidence: { type: "string" },
      sensitivity: { type: "string" },
      "observed-at": { type: "string" },
      "expires-at": { type: "string" },
      "source-kind": { type: "string" },
      "source-id": { type: "string" },
      "source-hash": { type: "string" },
      "review-event": { type: "string" },
      "summary-stdin": { type: "boolean" },
      supersedes: { type: "string" },
      "from-agent": { type: "string" },
      "to-agent": { type: "string" },
      entry: { type: "string", multiple: true },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${agentContextUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) throw new Error("The agent context action is invalid.");
  const action = parsed.positionals[0];
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  if (action === "inspect") {
    if (parsed.values.write || parsed.values.agent === undefined) {
      throw new Error("Agent context inspection is read-only and requires --agent.");
    }
    const storage = await openProjectStorage(root);
    try {
      const current = projection(storage, await listAgents(root), parsed.values.agent);
      output(
        io,
        current,
        parsed.values.json,
        `${current.agent.agentId} · ${current.entries.length} owned · ${current.inheritedEntries.length} inherited · ${current.readOnly ? "read-only" : "active"}`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  }
  if (action === "promote") {
    const layer = parsed.values.layer;
    const sourceKind = parsed.values["source-kind"];
    const sourceId = parsed.values["source-id"];
    const sourceHash = parsed.values["source-hash"];
    const reviewEventId = parsed.values["review-event"];
    const memoryKind = parsed.values.kind;
    const subjectKey = parsed.values.subject;
    const retrievalTerms = [...new Set(parsed.values["retrieval-term"] ?? [])].sort();
    const confidence = parsed.values.confidence ?? "medium";
    const sensitivity = parsed.values.sensitivity ?? "internal";
    if (
      !parsed.values.write ||
      !parsed.values["summary-stdin"] ||
      parsed.values.agent === undefined ||
      !["work", "relationship", "expertise"].includes(layer ?? "") ||
      !["event", "artifact"].includes(sourceKind ?? "") ||
      ![
        "work_outcome",
        "working_preference",
        "decision_rationale",
        "relationship",
        "expertise",
      ].includes(memoryKind ?? "") ||
      subjectKey === undefined ||
      !/^[a-z0-9][a-z0-9._:/-]{0,159}$/u.test(subjectKey) ||
      retrievalTerms.length === 0 ||
      retrievalTerms.length > 24 ||
      retrievalTerms.some(
        (term) => term.trim() !== term || term.length > 100 || /[\u0000-\u001f\u007f]/u.test(term),
      ) ||
      !["medium", "high"].includes(confidence) ||
      !["internal", "restricted"].includes(sensitivity) ||
      sourceId === undefined ||
      !/^sha256:[a-f0-9]{64}$/u.test(sourceHash ?? "") ||
      reviewEventId === undefined
    ) {
      throw new Error(
        "Agent context promotion requires exact source, review, summary, and --write.",
      );
    }
    if (io.stdin === undefined) throw new Error("Agent context promotion requires stdin support.");
    const summary = await io.stdin();
    if (summary.trim().length === 0 || Buffer.byteLength(summary) > 32_768) {
      throw new Error("The agent context summary is empty or exceeds 32 KiB.");
    }
    const result = await mutateAgentOrganization(root, async (storage) => {
      const agents = await listAgents(root);
      activeAgent(agents, parsed.values.agent!);
      const current = projection(storage, agents, parsed.values.agent!);
      const review = storage.events.get(reviewEventId);
      if (sourceKind === "event") {
        const source = storage.events.get(sourceId);
        if (source === null || source.eventHash !== sourceHash) {
          throw new Error("The context source event and hash do not match.");
        }
      } else {
        if (sourceId !== artifactId(sourceHash!)) {
          throw new Error("The context source artifact ID and hash do not match.");
        }
        if (!(await storage.artifacts.has(`lervo-cas://sha256/${sourceHash!.slice(7)}`))) {
          throw new Error("The context source artifact does not exist.");
        }
      }
      const summaryContentHash = `sha256:${createHash("sha256").update(summary).digest("hex")}`;
      if (
        review === null ||
        !agentContextReviewAttests({
          review,
          summaryContentHash,
          agentId: parsed.values.agent!,
        })
      ) {
        throw new Error("The review does not attest the exact context summary and agent.");
      }
      const promotedAt = new Date().toISOString();
      const observedAt = parsed.values["observed-at"] ?? promotedAt;
      const expiresAt = parsed.values["expires-at"] ?? null;
      if (
        !Number.isFinite(Date.parse(observedAt)) ||
        Date.parse(observedAt) > Date.parse(promotedAt) ||
        (expiresAt !== null &&
          (!Number.isFinite(Date.parse(expiresAt)) ||
            Date.parse(expiresAt) <= Date.parse(observedAt)))
      ) {
        throw new Error("The context observation, expiry, and promotion times are inconsistent.");
      }
      const superseded =
        parsed.values.supersedes === undefined
          ? undefined
          : current.entries.find(
              (entry) =>
                entry.contextEntryId === parsed.values.supersedes && entry.status === "active",
            );
      if (
        (parsed.values.supersedes !== undefined &&
          (superseded === undefined || superseded.layer !== layer)) ||
        current.entries.some(
          (entry) =>
            entry.status === "active" &&
            entry.layer === layer &&
            entry.subjectKey === subjectKey &&
            entry.contextEntryId !== parsed.values.supersedes,
        )
      ) {
        throw new Error("The context subject requires one exact same-layer supersession.");
      }
      const retrievalDigests = [
        ...new Set(
          retrievalTerms.map(
            (term) =>
              `sha256:${createHash("sha256")
                .update(term.normalize("NFKC").toLocaleLowerCase("en-US"))
                .digest("hex")}`,
          ),
        ),
      ].sort();
      const artifact = await storage.artifacts.put(summary);
      const content = {
        agentId: parsed.values.agent!,
        layer: layer as AgentContextPromotedEventPayload["layer"],
        memoryKind: memoryKind as NonNullable<AgentContextPromotedEventPayload["memoryKind"]>,
        subjectKey,
        audience: "agent" as const,
        sensitivity: sensitivity as NonNullable<AgentContextPromotedEventPayload["sensitivity"]>,
        confidence: confidence as NonNullable<AgentContextPromotedEventPayload["confidence"]>,
        retrievalDigests,
        observedAt,
        expiresAt,
        reviewBindingVersion: 2 as const,
        source: {
          kind: sourceKind as AgentContextPromotedEventPayload["source"]["kind"],
          sourceId,
          contentHash: sourceHash!,
        },
        summaryArtifactId: artifactId(artifact.contentHash),
        summaryContentHash: artifact.contentHash,
        summaryByteCount: artifact.byteCount,
        reviewEventId,
        reviewEventHash: review.eventHash,
        supersedesContextEntryId: parsed.values.supersedes ?? null,
        promotedAt,
      };
      const payload: AgentContextPromotedEventPayload = {
        contextEntryId: coordinate("actx", content),
        ...content,
      };
      appendContextEvent(storage, "agent.context.promoted", payload);
      return projection(storage, agents, parsed.values.agent!);
    });
    output(io, result, parsed.values.json, `Promoted context for ${parsed.values.agent}.`);
    return 0;
  }
  if (action === "handoff") {
    const fromAgentId = parsed.values["from-agent"];
    const toAgentId = parsed.values["to-agent"];
    const contextEntryIds = [...new Set(parsed.values.entry ?? [])].sort();
    if (
      !parsed.values.write ||
      fromAgentId === undefined ||
      toAgentId === undefined ||
      fromAgentId === toAgentId ||
      contextEntryIds.length === 0 ||
      contextEntryIds.length > 32
    ) {
      throw new Error("Agent context handoff requires distinct agents, entries, and --write.");
    }
    const result = await mutateAgentOrganization(root, async (storage) => {
      const agents = await listAgents(root);
      activeAgent(agents, toAgentId);
      const source = projection(storage, agents, fromAgentId);
      if (
        contextEntryIds.some(
          (entryId) => !source.entries.some((entry) => entry.contextEntryId === entryId),
        )
      ) {
        throw new Error("The handoff contains context not owned by the source agent.");
      }
      const recordedAt = new Date().toISOString();
      const manifest = `${JSON.stringify({ schemaVersion: 1, fromAgentId, toAgentId, contextEntryIds, recordedAt }, null, 2)}\n`;
      const artifact = await storage.artifacts.put(manifest);
      const content = {
        fromAgentId,
        toAgentId,
        contextEntryIds,
        manifestArtifactId: artifactId(artifact.contentHash),
        manifestContentHash: artifact.contentHash,
        manifestByteCount: artifact.byteCount,
        recordedAt,
      };
      const payload: AgentContextHandoffRecordedEventPayload = {
        contextHandoffId: coordinate("ach", content),
        ...content,
      };
      appendContextEvent(storage, "agent.context.handoff.recorded", payload);
      return projection(storage, agents, toAgentId);
    });
    output(io, result, parsed.values.json, `Handed context to ${toAgentId}.`);
    return 0;
  }
  throw new Error("The agent context action is invalid.");
}

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { listAgents } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import type { AgentContextHandoffRecordedEventPayload } from "@lervo/schemas";

import {
  activeAgent,
  type AgentContextPromotion,
  appendContextEvent,
  artifactId,
  contextCoordinate,
  contextProjection,
  promoteAgentContext,
} from "./agent-context-promotion.js";
import { mutateAgentOrganization } from "./agent-organization-mutation.js";
import type { CliIo } from "./types.js";

export const agentContextUsage = [
  "  lervo agent context inspect --agent <agent-id> [--root <path>] [--json]",
  "  lervo agent context promote --agent <agent-id> --layer <work|relationship|expertise> --kind <memory-kind> --subject <key> --retrieval-term <term> --source-kind <event|artifact> --source-id <id> --source-hash <sha256> --review-event <event-id> --summary-stdin [--confidence <medium|high>] [--sensitivity <internal|restricted>] [--observed-at <time>] [--expires-at <time>] [--supersedes <entry-id>] --write [--root <path>] [--json]",
  "  lervo agent context handoff --from-agent <id> --to-agent <id> --entry <context-entry-id> --write [--root <path>] [--json]",
].join("\n");

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
      const current = contextProjection(storage, await listAgents(root), parsed.values.agent);
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
    const result = await promoteAgentContext(root, {
      agentId: parsed.values.agent,
      layer: layer as AgentContextPromotion["layer"],
      memoryKind: memoryKind as AgentContextPromotion["memoryKind"],
      subjectKey,
      retrievalTerms,
      confidence: confidence as AgentContextPromotion["confidence"],
      sensitivity: sensitivity as AgentContextPromotion["sensitivity"],
      source: {
        kind: sourceKind as AgentContextPromotion["source"]["kind"],
        sourceId,
        contentHash: sourceHash!,
      },
      reviewEventId,
      summary: await io.stdin(),
      ...(parsed.values["observed-at"] === undefined
        ? {}
        : { observedAt: parsed.values["observed-at"] }),
      ...(parsed.values["expires-at"] === undefined
        ? {}
        : { expiresAt: parsed.values["expires-at"] }),
      ...(parsed.values.supersedes === undefined ? {} : { supersedes: parsed.values.supersedes }),
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
      const source = contextProjection(storage, agents, fromAgentId);
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
        contextHandoffId: contextCoordinate("ach", content),
        ...content,
      };
      appendContextEvent(storage, "agent.context.handoff.recorded", payload, recordedAt);
      return contextProjection(storage, agents, toAgentId);
    });
    output(io, result, parsed.values.json, `Handed context to ${toAgentId}.`);
    return 0;
  }
  throw new Error("The agent context action is invalid.");
}

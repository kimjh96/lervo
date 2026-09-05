import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createRootAgentLivenessObservation,
  isRootAgentLivenessObservation,
  listAgents,
  observeRootAgentLiveness,
  type RootAgentLivenessObservation,
  type RootAgentReportingProvider,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { validateSchema } from "@lervo/schemas";

import type { CliIo } from "./types.js";

export const agentLivenessUsage = [
  "  lervo agent heartbeat --agent <agent-id> --revision <n> --provider <codex|claude> --session <id> --write [--root <path>] [--json]",
  "  lervo agent inspect --agent <agent-id> [--stale-after-ms <ms>] [--root <path>] [--json]",
].join("\n");

function integer(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^\d+$/u.test(value))
    throw new Error("An integer agent-liveness coordinate is invalid.");
  return Number(value);
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      revision: { type: "string" },
      provider: { type: "string" },
      session: { type: "string" },
      "stale-after-ms": { type: "string" },
      root: { type: "string" },
      write: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

function output(io: CliIo, value: unknown, json: boolean | undefined, message: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
}

function latestLivenessObservation(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
  agentId: string,
): RootAgentLivenessObservation[] {
  let latest: RootAgentLivenessObservation | null = null;
  let afterSeq = 0;
  while (true) {
    const page = storage.events.list({ afterSeq, limit: 1_000 });
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type !== "agent.liveness.observed") continue;
      if (
        !validateSchema("agentLivenessObservedEventPayload", event.payload).valid ||
        !isRootAgentLivenessObservation(event.payload)
      )
        throw new Error("A stored root-agent liveness event is invalid.");
      if (
        event.payload.agentId === agentId &&
        (latest === null ||
          Date.parse(event.payload.observedAt) > Date.parse(latest.observedAt) ||
          (event.payload.observedAt === latest.observedAt &&
            event.payload.agentRevision > latest.agentRevision))
      )
        latest = event.payload;
    }
    if (page.length < 1_000) return latest === null ? [] : [latest];
  }
}

export async function runAgentLivenessCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parse(args);
  if (parsed.values.help) {
    io.stdout(`${agentLivenessUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1 || parsed.values.agent === undefined)
    throw new Error("Agent liveness requires one action and an exact agent ID.");
  const action = parsed.positionals[0];
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const agents = await listAgents(root);
  const agent = agents.find((candidate) => candidate.agentId === parsed.values.agent);
  if (agent === undefined) throw new Error("The agent does not exist.");

  if (action === "heartbeat") {
    if (
      !parsed.values.write ||
      parsed.values.session === undefined ||
      (parsed.values.provider !== "codex" && parsed.values.provider !== "claude") ||
      parsed.values["stale-after-ms"] !== undefined
    )
      throw new Error(
        "Agent heartbeat requires revision, provider, session, and --write without inspection options.",
      );
    const observation = createRootAgentLivenessObservation({
      agent,
      expectedRevision: integer(parsed.values.revision),
      reportingProvider: parsed.values.provider as RootAgentReportingProvider,
      providerSessionId: parsed.values.session,
      observedAt: new Date(),
    });
    const storage = await openProjectStorage(root);
    try {
      if (storage.writableEventSchemaVersion !== 2)
        throw new Error("Root-agent heartbeat requires the active event writer schema v2.");
      const identity = randomUUID().replaceAll("-", "");
      const recorded = storage.events.append({
        eventId: `evt_${identity}`,
        projectId: storage.manifest.projectId,
        runId: `run_${identity}`,
        sessionId: `ses_${identity}`,
        type: "agent.liveness.observed",
        occurredAt: observation.observedAt,
        actor: { kind: "agent", provider: observation.reportingProvider },
        schemaVersion: 2,
        policyVersion: sha256(JSON.stringify(observation)),
        payload: { ...observation },
      });
      const receipt = {
        schemaVersion: 1,
        status: recorded.inserted ? "recorded" : "already_recorded",
        eventId: recorded.event.eventId,
        observation,
      };
      output(
        io,
        receipt,
        parsed.values.json,
        `Root-agent heartbeat ${receipt.status} for ${agent.agentId} revision ${agent.revision}.`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  }

  if (action === "inspect") {
    if (
      parsed.values.write ||
      parsed.values.revision !== undefined ||
      parsed.values.provider !== undefined ||
      parsed.values.session !== undefined
    )
      throw new Error("Agent liveness inspection is read-only and rejects heartbeat options.");
    const storage = await openProjectStorage(root);
    try {
      const observations = latestLivenessObservation(storage, agent.agentId);
      const liveness = observeRootAgentLiveness({
        agent,
        observations,
        observedAt: new Date(),
        ...(parsed.values["stale-after-ms"] === undefined
          ? {}
          : { staleAfterMs: integer(parsed.values["stale-after-ms"]) }),
      });
      output(
        io,
        { schemaVersion: 1, agent, liveness },
        parsed.values.json,
        `${agent.agentId} · ${agent.status} · liveness ${liveness.status}${liveness.ageMs === null ? "" : ` · age ${liveness.ageMs}ms`}`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  }

  throw new Error("The agent-liveness action is invalid.");
}

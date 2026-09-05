import { createHash } from "node:crypto";

import type { WorkforceAgent } from "./types.js";

const AGENT_ID = /^agt_[a-f0-9]{24}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SESSION_ID = /^ses_[A-Za-z0-9_-]{8,128}$/u;

export const DEFAULT_ROOT_AGENT_LIVENESS_STALE_AFTER_MS = 2 * 60 * 1_000;

export type RootAgentReportingProvider = "codex" | "claude";

export interface RootAgentLivenessObservation {
  agentId: string;
  agentRevision: number;
  reportingProvider: RootAgentReportingProvider;
  providerSessionDigest: string;
  observedAt: string;
}

export interface RootAgentLiveness {
  schemaVersion: 1;
  agentId: string;
  agentRevision: number;
  status:
    | "inactive"
    | "unobserved"
    | "agent_revision_changed"
    | "recently_observed"
    | "stale_observation";
  latestObservedAt: string | null;
  reportingProvider: RootAgentReportingProvider | null;
  providerSessionDigest: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  releasesAgentAuthority: false;
  provesManagedProcessHealth: false;
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isRootAgentLivenessObservation(
  value: unknown,
): value is RootAgentLivenessObservation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const observation = value as RootAgentLivenessObservation;
  return (
    AGENT_ID.test(observation.agentId) &&
    Number.isSafeInteger(observation.agentRevision) &&
    observation.agentRevision >= 1 &&
    ["codex", "claude"].includes(observation.reportingProvider) &&
    HASH.test(observation.providerSessionDigest) &&
    validTime(observation.observedAt)
  );
}

function assertRootAgent(agent: WorkforceAgent): void {
  if (agent.parentAgentId !== null)
    throw new Error("Root-agent liveness cannot be reported for a child agent.");
}

export function resolveRootAgentLivenessStaleAfterMs(value?: number): number {
  const staleAfterMs = value ?? DEFAULT_ROOT_AGENT_LIVENESS_STALE_AFTER_MS;
  if (
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs < 1_000 ||
    staleAfterMs > 24 * 60 * 60 * 1_000
  ) {
    throw new Error("The root-agent liveness threshold is invalid.");
  }
  return staleAfterMs;
}

export function createRootAgentLivenessObservation(input: {
  agent: WorkforceAgent;
  expectedRevision: number;
  reportingProvider: RootAgentReportingProvider;
  providerSessionId: string;
  observedAt: Date;
}): RootAgentLivenessObservation {
  assertRootAgent(input.agent);
  if (input.agent.status !== "active" || input.agent.revision !== input.expectedRevision)
    throw new Error("Root-agent liveness requires the exact active agent revision.");
  if (input.agent.provider !== "any" && input.agent.provider !== input.reportingProvider)
    throw new Error("The reporting provider is outside the agent provider authority.");
  if (!SESSION_ID.test(input.providerSessionId))
    throw new Error("The provider session coordinate is invalid.");
  if (!Number.isFinite(input.observedAt.getTime()))
    throw new Error("The root-agent liveness observation time is invalid.");
  const providerSessionDigest = `sha256:${createHash("sha256")
    .update("lervo:root-agent-liveness-session:v1\0")
    .update(input.reportingProvider)
    .update("\0")
    .update(input.providerSessionId)
    .digest("hex")}`;
  return {
    agentId: input.agent.agentId,
    agentRevision: input.agent.revision,
    reportingProvider: input.reportingProvider,
    providerSessionDigest,
    observedAt: input.observedAt.toISOString(),
  };
}

export function observeRootAgentLiveness(input: {
  agent: WorkforceAgent;
  observations: RootAgentLivenessObservation[];
  observedAt: Date;
  staleAfterMs?: number;
}): RootAgentLiveness {
  assertRootAgent(input.agent);
  const staleAfterMs = resolveRootAgentLivenessStaleAfterMs(input.staleAfterMs);
  if (!Number.isFinite(input.observedAt.getTime()))
    throw new Error("The root-agent liveness inspection time is invalid.");

  const relevant = input.observations
    .filter((observation) => observation.agentId === input.agent.agentId)
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
        right.agentRevision - left.agentRevision,
    );
  const latest = relevant[0] ?? null;
  const base = {
    schemaVersion: 1 as const,
    agentId: input.agent.agentId,
    agentRevision: input.agent.revision,
    latestObservedAt: latest?.observedAt ?? null,
    reportingProvider: latest?.reportingProvider ?? null,
    providerSessionDigest: latest?.providerSessionDigest ?? null,
    ageMs:
      latest === null
        ? null
        : Math.max(0, input.observedAt.getTime() - Date.parse(latest.observedAt)),
    staleAfterMs,
    releasesAgentAuthority: false as const,
    provesManagedProcessHealth: false as const,
  };
  if (input.agent.status !== "active") return { ...base, status: "inactive" };
  if (latest === null) return { ...base, status: "unobserved" };
  if (latest.agentRevision !== input.agent.revision)
    return { ...base, status: "agent_revision_changed" };
  return {
    ...base,
    status: base.ageMs! > staleAfterMs ? "stale_observation" : "recently_observed",
  };
}

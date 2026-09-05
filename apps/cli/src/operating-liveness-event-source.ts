import {
  isRootAgentLivenessObservation,
  type RootAgentLivenessObservation,
} from "@lervo/agent-workforce";
import type { ProviderProcessObservedEventPayload } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";

import type { ManagedProviderProcessObservationSource } from "./operating-liveness-projection.js";

export interface OperatingLivenessEventSources {
  rootAgentObservations: RootAgentLivenessObservation[];
  managedProviderProcessObservations: ManagedProviderProcessObservationSource[];
}

function newer(
  candidate: { observedAt: string; sequence: number },
  current: { observedAt: string; sequence: number },
): boolean {
  return (
    Date.parse(candidate.observedAt) > Date.parse(current.observedAt) ||
    (candidate.observedAt === current.observedAt && candidate.sequence > current.sequence)
  );
}

function recordRootAgentObservation(
  roots: Map<string, RootAgentLivenessObservation & { sequence: number }>,
  payload: unknown,
  sequence: number,
): void {
  if (
    !validateSchema("agentLivenessObservedEventPayload", payload).valid ||
    !isRootAgentLivenessObservation(payload)
  ) {
    throw new Error("A stored root-agent liveness event is invalid.");
  }
  const candidate = { ...payload, sequence };
  const current = roots.get(candidate.agentId);
  if (current === undefined || newer(candidate, current)) roots.set(candidate.agentId, candidate);
}

function observationsWithoutSequence(
  roots: Map<string, RootAgentLivenessObservation & { sequence: number }>,
): RootAgentLivenessObservation[] {
  return [...roots.values()].map(({ sequence: _sequence, ...item }) => item);
}

export function readLatestRootAgentLivenessObservations(
  events: OutboxStore,
  agentId: string,
): RootAgentLivenessObservation[] {
  const roots = new Map<string, RootAgentLivenessObservation & { sequence: number }>();
  let afterSeq = 0;
  while (true) {
    const page = events.list({ afterSeq, limit: 1_000 });
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type === "agent.liveness.observed") {
        recordRootAgentObservation(roots, event.payload, event.seq);
      }
    }
    if (page.length < 1_000)
      return observationsWithoutSequence(roots).filter(
        (observation) => observation.agentId === agentId,
      );
  }
}

export function readOperatingLivenessEventSources(
  events: OutboxStore,
): OperatingLivenessEventSources {
  const roots = new Map<string, RootAgentLivenessObservation & { sequence: number }>();
  const processes = new Map<string, ManagedProviderProcessObservationSource>();
  let afterSeq = 0;
  while (true) {
    const page = events.list({ afterSeq, limit: 1_000 });
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type === "agent.liveness.observed") {
        recordRootAgentObservation(roots, event.payload, event.seq);
      }
      if (event.type === "provider.process.observed") {
        if (!validateSchema("providerProcessObservedEventPayload", event.payload).valid) {
          throw new Error("A stored managed-provider process observation event is invalid.");
        }
        const payload = event.payload as ProviderProcessObservedEventPayload;
        if (event.actor.provider === undefined) {
          throw new Error("A stored managed-provider process observation has no provider.");
        }
        const candidate: ManagedProviderProcessObservationSource = {
          eventId: event.eventId,
          sequence: event.seq,
          runId: event.runId,
          sessionId: event.sessionId,
          provider: event.actor.provider,
          ...payload,
        };
        const current = processes.get(candidate.providerSessionDigest);
        if (current === undefined || newer(candidate, current)) {
          processes.set(candidate.providerSessionDigest, candidate);
        }
      }
    }
    if (page.length < 1_000) break;
  }
  return {
    rootAgentObservations: observationsWithoutSequence(roots),
    managedProviderProcessObservations: [...processes.values()],
  };
}

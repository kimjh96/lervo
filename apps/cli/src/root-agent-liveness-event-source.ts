import {
  isRootAgentLivenessObservation,
  type RootAgentLivenessObservation,
} from "@lervo/agent-workforce";
import { validateSchema } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";

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
      return [...roots.values()]
        .map(({ sequence: _sequence, ...item }) => item)
        .filter((observation) => observation.agentId === agentId);
  }
}

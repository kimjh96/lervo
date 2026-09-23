import { canonicalJson } from "@lervo/event-contract";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  managedExecutionIdentity,
  operatingContractHash,
} from "@lervo/work-controller";

import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  observeNodeSupervisionSettlementAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import {
  currentUnitInvocationId,
  observeAbandonedTurnWitness,
} from "./supervision-invocation-witness.js";
import {
  interruptedOwnerReconciliationEventId,
  readProvenInterruptedOwnerReasoning,
} from "./supervision-interrupted-owner-source.js";
import {
  isProvenInterruptedOwnerReasoning,
  type InterruptedOwnerReasoningDiagnostic,
} from "./supervision-interrupted-owner-proof.js";
import { NodeSupervisionStore } from "./supervision-store.js";

const RUN_ID = /^run_[a-f0-9]{32}$/u;
const TYPE = "work.supervision.owner_reasoning.interruption_reconciled";

/** Repair one already failed read-only owner turn; never append another terminal or authorize replay. */
export async function reconcileInterruptedOwnerReasoning(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  runId: string;
  unit: string;
  now?: () => string;
  observeWitness?: typeof observeAbandonedTurnWitness;
  currentInvocation?: typeof currentUnitInvocationId;
}): Promise<{ eventId: string; diagnosticArtifactHash: string }> {
  if (!RUN_ID.test(input.runId)) throw new Error("The managed run ID is invalid.");
  const now = input.now ?? (() => new Date().toISOString());
  const observeWitness = input.observeWitness ?? observeAbandonedTurnWitness;
  const currentInvocation = input.currentInvocation ?? currentUnitInvocationId;
  const owner = await NodeSupervisionStore.open({
    repositoryRoot: input.repositoryRoot,
    binding: input.binding,
    now,
  });
  try {
    const result = await owner.withOwner(async (session) => {
      const storage = await openProjectStorage(input.repositoryRoot);
      try {
        const authority = await observeNodeSupervisionSettlementAuthority(
          storage,
          input.binding,
          now,
        );
        const runEvents = collectRunEventsBounded({
          events: storage.events,
          runId: input.runId,
          maximumEvents: 512,
        });
        const terminal = runEvents.at(-1);
        if (terminal?.type !== "run.failed" || runEvents[0]?.type !== "managed.execution.reserved")
          throw new Error("The owner run has no exact failed managed-turn history.");
        const planHash = String(runEvents[0].payload.executionKey);
        const decisions: EventEnvelope[] = [];
        let afterSeq = 0;
        while (true) {
          const page = storage.events.list({ afterSeq, limit: 1000 });
          if (page.length === 0) break;
          decisions.push(
            ...page.filter(
              (event) =>
                event.type === "work.supervision.decision.recorded" &&
                event.payload.planHash === planHash,
            ),
          );
          afterSeq = page.at(-1)!.seq;
          if (page.length < 1000) break;
        }
        if (decisions.length !== 1)
          throw new Error("The failed owner run has no unique admitted decision.");
        const plan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          String(decisions[0]!.payload.planArtifactHash),
        )) as OperatingActionPlanV1;
        assertOperatingActionPlan(plan);
        const admitted = await readAdmittedControlDecision(storage, plan);
        if (
          admitted.decision.eventId !== decisions[0]!.eventId ||
          plan.effectContract !== "work.owner_reasoning.v1" ||
          plan.projectId !== storage.manifest.projectId ||
          plan.supervisionId !== input.binding.supervisionId ||
          plan.workstreamId !== input.binding.workstreamId ||
          plan.ownerAgentId !== input.binding.ownerAgentId ||
          plan.mandateHash !== input.binding.mandateHash ||
          managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId !==
            input.runId ||
          (await readProvenInterruptedOwnerReasoning({ storage, plan })) !== null
        )
          throw new Error(
            "The failed owner run differs from its binding or is already reconciled.",
          );
        const eventId = interruptedOwnerReconciliationEventId(admitted.runId, admitted.identity);
        if (storage.events.get(eventId) !== null)
          throw new Error("The owner interruption has an existing reconciliation record.");
        const witness = observeWitness({
          unit: input.unit,
          incidentAt: terminal.occurredAt,
          observedAt: now(),
        });
        const diagnostic: InterruptedOwnerReasoningDiagnostic = {
          schemaVersion: 1,
          kind:
            terminal.payload.failureCode === "provider_start_failed"
              ? "work.owner_reasoning_unacknowledged_start_failure"
              : "work.owner_reasoning_interrupted_stop_failure",
          runEvents: runEvents.map((event) => ({
            eventId: event.eventId,
            eventHash: event.eventHash,
            type: event.type,
          })),
          witness,
        };
        const artifact = await storage.artifacts.put(canonicalJson(diagnostic));
        const head = storage.events.latest();
        if (head === null) throw new Error("The owner interruption has no event head.");
        const payload = {
          schemaVersion: 1,
          projectId: plan.projectId,
          workstreamId: plan.workstreamId,
          workstreamRevision: Number(admitted.decision.payload.workstreamRevision),
          supervisionId: plan.supervisionId,
          ownerAgentId: plan.ownerAgentId,
          mandateHash: plan.mandateHash,
          causationEventIds: [admitted.decision.eventId, terminal.eventId],
          decisionId: admitted.identity,
          planHash,
          managedRunId: input.runId,
          terminalEventId: terminal.eventId,
          diagnosticArtifactHash: artifact.contentHash,
        };
        const candidate = {
          ...head,
          eventId,
          seq: head.seq + 1,
          projectId: plan.projectId,
          runId: admitted.runId,
          sessionId: admitted.decision.sessionId,
          schemaVersion: 3 as const,
          type: TYPE,
          occurredAt: now(),
          actor: { kind: "system" as const },
          policyVersion: admitted.decision.policyVersion,
          payload,
        } as EventEnvelope;
        if (!isProvenInterruptedOwnerReasoning(runEvents, candidate, diagnostic))
          throw new Error("The interrupted owner proof failed before admission.");
        const confirmed = await observeNodeSupervisionSettlementAuthority(
          storage,
          input.binding,
          now,
        );
        if (confirmed.installation.latestEventId !== authority.installation.latestEventId)
          throw new Error("The owner interruption authority changed before commit.");
        session.commit(() =>
          storage.events.transact((transaction) => {
            const commitAt = now();
            const age = Date.parse(commitAt) - Date.parse(witness.observedAt);
            const currentRun = collectRunEventsBounded({
              events: storage.events,
              runId: input.runId,
              maximumEvents: 512,
            });
            if (
              age < 0 ||
              age > 5000 ||
              currentInvocation(input.unit) !== witness.currentInvocationId ||
              storage.events.latest()?.eventHash !== head.eventHash ||
              currentRun.length !== runEvents.length ||
              currentRun.some((event, index) => event.eventHash !== runEvents[index]?.eventHash)
            )
              throw new Error("The interrupted owner evidence changed at the owner-fenced commit.");
            const appended = transaction.append({
              eventId,
              projectId: plan.projectId,
              runId: admitted.runId,
              sessionId: admitted.decision.sessionId,
              schemaVersion: 3,
              type: TYPE,
              occurredAt: commitAt,
              actor: { kind: "system" },
              policyVersion: admitted.decision.policyVersion,
              payload,
            });
            if (appended.redactions.length !== 0)
              throw new Error("The interrupted owner reconciliation was redacted.");
          }),
        );
        return { eventId, diagnosticArtifactHash: artifact.contentHash };
      } finally {
        await storage.close();
      }
    });
    if (result === null) throw new Error("The owner interruption lease is busy.");
    return result;
  } finally {
    await owner.close();
  }
}

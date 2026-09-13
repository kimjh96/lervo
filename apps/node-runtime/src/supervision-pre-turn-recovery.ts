import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  managedExecutionIdentity,
  operatingContractHash,
} from "@lervo/work-controller";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { observePreTurnBootWitness, currentLinuxBootId } from "./supervision-boot-witness.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  isProvenPreTurnFailure,
  type PreTurnFailureDiagnostic,
} from "./supervision-pre-turn-failure.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { NodeSupervisionStore } from "./supervision-store.js";

const RUN_ID = /^run_[a-f0-9]{32}$/u;

/** One owner-fenced terminal for an exact pre-turn prefix killed by a proved Linux reboot. */
export async function recoverInterruptedPreTurn(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  runId: string;
  now?: () => string;
}): Promise<{ eventId: string; diagnosticDigest: string }> {
  if (!RUN_ID.test(input.runId)) throw new Error("The recovery run ID is invalid.");
  const now = input.now ?? (() => new Date().toISOString());
  const owner = await NodeSupervisionStore.open({
    repositoryRoot: input.repositoryRoot,
    binding: input.binding,
    now,
  });
  try {
    const result = await owner.withOwner(async (session) => {
      const storage = await openProjectStorage(input.repositoryRoot);
      try {
        const authority = await session.readRecoveryAuthority();
        if (
          authority.installation.revoked ||
          !authority.source.eligible ||
          Date.parse(now()) >= Date.parse(authority.installation.mandate.expiresAt)
        )
          throw new Error("The recovery owner authority is ineligible.");
        const events = collectRunEventsBounded({
          events: storage.events,
          runId: input.runId,
          maximumEvents: 16,
        });
        const reserved = events[0];
        if (events.length !== 5 || reserved?.type !== "managed.execution.reserved")
          throw new Error("The interrupted run does not have the exact pre-turn prefix.");
        const decisions = [];
        for (let afterSeq = 0; afterSeq < (storage.events.latest()?.seq ?? 0);) {
          const page = storage.events.list({ afterSeq, limit: 1000 });
          if (page.length === 0) break;
          decisions.push(
            ...page.filter(
              (event) =>
                event.type === "work.supervision.decision.recorded" &&
                event.payload.planHash === reserved.payload.executionKey,
            ),
          );
          afterSeq = page.at(-1)!.seq;
        }
        if (decisions.length !== 1)
          throw new Error("The interrupted run has no unique admitted decision.");
        const plan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          String(decisions[0]!.payload.planArtifactHash),
        )) as OperatingActionPlanV1;
        assertOperatingActionPlan(plan);
        const admitted = await readAdmittedControlDecision(storage, plan);
        if (
          admitted.decision.eventId !== decisions[0]!.eventId ||
          !["work.managed_execution.v1", "work.managed_execution.v2"].includes(
            plan.effectContract,
          ) ||
          plan.projectId !== storage.manifest.projectId ||
          plan.workstreamId !== input.binding.workstreamId ||
          plan.ownerAgentId !== input.binding.ownerAgentId ||
          managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId !==
            input.runId ||
          reserved.payload.executionKey !== operatingContractHash(plan)
        )
          throw new Error("The interrupted run differs from its admitted decision.");
        const observedAt = now();
        const witness = observePreTurnBootWitness(events[4]!.occurredAt, observedAt);
        const diagnostic: PreTurnFailureDiagnostic = {
          schemaVersion: 1,
          kind: "work.managed_pre_turn_failure",
          failures: [{ code: "interrupted_before_turn", phase: "recovery", retryable: true }],
          runEvents: events.map((event) => ({
            eventId: event.eventId,
            eventHash: event.eventHash,
            type: event.type,
          })),
          witness,
        };
        const artifact = await storage.artifacts.put(canonicalJson(diagnostic));
        const head = storage.events.latest();
        if (head === null) throw new Error("The recovery event head is absent.");
        const eventId = `evt_${operatingContractHash({ runId: input.runId, kind: "interrupted_before_turn" }).slice(7, 39)}`;
        const occurredAt = now();
        const terminal = {
          ...events[4]!,
          type: "run.failed" as const,
          eventId,
          seq: head.seq + 1,
          occurredAt,
          payload: {
            failureCode: "interrupted_before_turn",
            retryable: true,
            diagnosticDigest: artifact.contentHash,
          },
        } as EventEnvelope;
        if (!isProvenPreTurnFailure([...events, terminal], diagnostic))
          throw new Error("The pre-turn proof failed before terminal admission.");
        const confirmed = await session.readRecoveryAuthority();
        if (
          confirmed.installation.latestEventId !== authority.installation.latestEventId ||
          confirmed.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
          !confirmed.source.eligible
        )
          throw new Error("The recovery authority changed before commit.");
        session.commit(() =>
          storage.events.transact((transaction) => {
            const commitAt = now();
            const age = Date.parse(commitAt) - Date.parse(witness.observedAt);
            const currentRun = collectRunEventsBounded({
              events: storage.events,
              runId: input.runId,
              maximumEvents: 16,
            });
            if (
              age < 0 ||
              age > 5000 ||
              currentLinuxBootId() !== witness.currentBootId ||
              storage.events.latest()?.eventHash !== head.eventHash ||
              currentRun.length !== 5 ||
              currentRun.some((event, index) => event.eventHash !== events[index]?.eventHash)
            )
              throw new Error("The pre-turn evidence changed at the owner-fenced commit.");
            const appended = transaction.append({
              eventId,
              projectId: plan.projectId,
              runId: input.runId,
              sessionId: events[4]!.sessionId,
              schemaVersion: 1,
              type: "run.failed",
              occurredAt: commitAt,
              actor: { kind: "system" },
              policyVersion: events[4]!.policyVersion,
              payload: {
                failureCode: "interrupted_before_turn",
                retryable: true,
                diagnosticDigest: artifact.contentHash,
              },
            });
            if (appended.redactions.length !== 0)
              throw new Error("The pre-turn terminal was redacted.");
          }),
        );
        return { eventId, diagnosticDigest: artifact.contentHash };
      } finally {
        await storage.close();
      }
    });
    if (result === null) throw new Error("The recovery owner lease is busy.");
    return result;
  } finally {
    await owner.close();
  }
}

import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
  OutcomeSupervisionReportV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  operatingDecisionId,
  supervisedOwnerReasoningFields,
  managedExecutionIdentity,
  parseOwnerReasoningDecision,
} from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";
import { readHistoricalOwnerDecision } from "./supervision-control-decision.js";
import {
  assertOwnerReasoningContext,
  OwnerReasoningSourceChangedError,
  type OwnerReasoningContext,
} from "./supervision-reasoning-context.js";
import { inspectOwnerReasoning } from "./supervision-reasoning-receipt.js";

export async function readOwnerReasoningHistory(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  basisHash: string;
  excludeDecisionId?: string;
}) {
  const entries: { plan: OperatingActionPlanV1; effect: SupervisedOwnerReasoningV1 }[] = [];
  for (const event of input.source.events) {
    if (
      event.type !== "work.supervision.decision.recorded" ||
      event.payload.supervisionId !== input.binding.supervisionId ||
      event.payload.decisionId === input.excludeDecisionId
    )
      continue;
    const plan = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      String(event.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    if (plan.effectContract !== "work.owner_reasoning.v1") continue;
    const historical = await readHistoricalOwnerDecision(input.storage, plan);
    const effect = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      plan.effectHash,
    )) as SupervisedOwnerReasoningV1;
    const fields = supervisedOwnerReasoningFields(effect);
    if (
      Object.entries(fields).some(
        ([key, value]) =>
          operatingContractHash(value) !==
          operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
      ) ||
      operatingDecisionId(plan) !== event.payload.decisionId ||
      plan.workstreamId !== input.binding.workstreamId ||
      plan.ownerAgentId !== input.binding.ownerAgentId
    )
      throw new Error("Owner reasoning history has conflicting effect authority.");
    if (
      plan.mandateHash === input.binding.mandateHash &&
      !historical.superseded &&
      effect.basisHash === input.basisHash
    )
      entries.push({ plan, effect });
  }
  if (
    entries.length > 3 ||
    entries.some((entry, index) => entry.effect.attemptNumber !== index + 1)
  )
    throw new Error("Owner reasoning history exceeds or contradicts its bounded attempt sequence.");
  return entries;
}

export async function readReusableOwnerDecision(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  basisHash: string;
  report: OutcomeSupervisionReportV1;
  now(): string;
}) {
  const history = await readOwnerReasoningHistory(input);
  // An exhausted provider allowance blocks every later owner turn, whatever its trigger, until a
  // reviewed mandate change starts a new history; retrying would only reserve more tokens.
  const latest = history.at(-1);
  if (latest !== undefined) {
    const identity = managedExecutionIdentity(
      latest.plan.projectId,
      operatingContractHash(latest.plan),
    );
    if (
      input.source.events.some(
        (event) =>
          event.runId === identity.runId &&
          event.type === "run.failed" &&
          event.payload.failureCode === "provider_usage_limited",
      )
    )
      return { history, decision: null, reason: "provider_usage_limited" as const };
  }
  for (const entry of [...history].reverse()) {
    const context = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      entry.effect.contextArtifactHash,
    )) as OwnerReasoningContext;
    if (
      operatingContractHash(context.trigger) !==
      operatingContractHash({
        reasonCode: input.report.reasonCode,
        nextAction: input.report.nextAction,
        assignmentIds: input.report.assignmentIds,
      })
    )
      continue;
    try {
      await assertOwnerReasoningContext({ ...input, context });
    } catch (error) {
      if (!(error instanceof OwnerReasoningSourceChangedError)) throw error;
      return { history, decision: null, reason: "reasoning_source_changed" as const };
    }
    const receipt = await inspectOwnerReasoning(input.storage, entry.plan);
    if (receipt.status !== "confirmed")
      return { history, decision: null, reason: "reasoning_effect_unresolved" as const };
    const identity = managedExecutionIdentity(
      entry.plan.projectId,
      operatingContractHash(entry.plan),
    );
    const terminal = input.source.events.find(
      (event) => event.runId === identity.runId && event.type === "run.completed",
    );
    if (terminal === undefined) continue;
    const resultArtifactHash = String(terminal.payload.resultDigest);
    const resultText = await readSupervisionTextArtifact(
      input.storage.artifacts,
      resultArtifactHash,
    );
    let decision;
    try {
      decision = parseOwnerReasoningDecision(resultText);
    } catch {
      return {
        history,
        decision: null,
        reasoningPlanHash: operatingContractHash(entry.plan),
        resultArtifactHash,
        reason: "invalid_reasoning_result" as const,
      };
    }
    return {
      history,
      decision,
      reasoningPlanHash: operatingContractHash(entry.plan),
      resultArtifactHash,
      reason: "available" as const,
    };
  }
  return { history, decision: null, reason: "no_current_reasoning_result" as const };
}

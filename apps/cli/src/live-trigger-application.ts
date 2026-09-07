import { listAssignments } from "@lervo/agent-workforce";
import type { LiveWebhookAdapter, LiveWebhookRequestHandler } from "@lervo/adapter-webhook";
import {
  createLiveTriggerAdmissionPlan,
  type LiveTriggerCompletionV1,
  type LiveTriggerReservationStoreV1,
  type LiveWebhookAuthorizationV1,
} from "@lervo/live-trigger-contract";
import { openProjectStorage } from "@lervo/project-storage";

import { materializeAssignmentRoutine } from "./assignment-routine-materialization.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export interface LiveTriggerApplicationDependencies {
  adapter: LiveWebhookAdapter;
  store: LiveTriggerReservationStoreV1;
  repositoryRoot: string;
  loadAuthorization(): Promise<LiveWebhookAuthorizationV1>;
  now?(): Date;
}

function completionDisposition(
  value: "materialize" | "resume" | "already_materialized" | "skipped" | "coalesced" | "blocked",
): LiveTriggerCompletionV1["disposition"] {
  if (value === "materialize") return "materialized";
  if (value === "resume") return "resumed";
  if (value === "blocked") throw new Error("A blocked routine cannot produce completion evidence.");
  return value;
}

function rejected(statusCode: number, failureCode: string, details?: unknown) {
  return {
    statusCode,
    body: {
      status: "rejected",
      failureCode,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function createLiveTriggerApplication(
  dependencies: LiveTriggerApplicationDependencies,
): LiveWebhookRequestHandler {
  const now = dependencies.now ?? (() => new Date());
  return {
    async handle(request) {
      const observation = await dependencies.adapter.authenticate(request);
      const authorization = await dependencies.loadAuthorization();
      const storage = await openProjectStorage(dependencies.repositoryRoot);
      let projectId: string;
      let workstreamId: string;
      try {
        const workstream = await verifiedCurrentWorkstream(storage);
        if (workstream === null || workstream.status !== "active")
          return rejected(409, "active_workstream_required");
        projectId = storage.manifest.projectId;
        workstreamId = workstream.workstreamId;
      } finally {
        await storage.close();
      }
      const plan = createLiveTriggerAdmissionPlan({
        projectId,
        currentWorkstreamId: workstreamId,
        authorization,
        observation,
        admittedAt: now().toISOString(),
      });
      if (plan.status === "blocked")
        return rejected(403, "authorization_denied", plan.blockedReasons);

      const preflight = await materializeAssignmentRoutine({
        repositoryRoot: dependencies.repositoryRoot,
        request: plan.request,
        liveTriggerPlan: plan,
      });
      if (preflight.plan.status === "blocked")
        return rejected(409, "routine_blocked", preflight.plan.blockedReasons);

      const reservation = await dependencies.store.reserve(plan);
      if (reservation.status === "current") {
        return { statusCode: 200, body: { status: "current", completion: reservation.completion } };
      }
      if (reservation.status === "in_progress") return rejected(409, "trigger_in_progress");
      if (reservation.status === "idempotency_conflict")
        return rejected(409, "idempotency_conflict");
      if (reservation.status === "budget_exhausted")
        return rejected(429, "trigger_budget_exhausted");
      if (reservation.status === "capacity_exhausted")
        return rejected(503, "trigger_capacity_exhausted");

      try {
        const outcome =
          preflight.plan.status === "ready"
            ? await materializeAssignmentRoutine({
                repositoryRoot: dependencies.repositoryRoot,
                request: plan.request,
                applyPlanId: preflight.plan.planId,
                liveTriggerPlan: plan,
              })
            : preflight;
        const assignments = await listAssignments(dependencies.repositoryRoot);
        const completion: LiveTriggerCompletionV1 = {
          schemaVersion: 1,
          planId: plan.planId,
          invocationId: outcome.plan.invocationId,
          disposition: completionDisposition(outcome.plan.disposition),
          assignmentIds: assignments
            .filter((assignment) => assignment.routine?.invocationId === outcome.plan.invocationId)
            .map((assignment) => assignment.assignmentId)
            .sort(),
          completedAt: now().toISOString(),
        };
        await dependencies.store.complete({ reservationId: reservation.reservationId, completion });
        return { statusCode: 202, body: { status: "accepted", completion } };
      } catch {
        await dependencies.store.requireRecovery({
          reservationId: reservation.reservationId,
          failedAt: now().toISOString(),
        });
        return rejected(503, "recovery_required", { planId: plan.planId });
      }
    },
  };
}

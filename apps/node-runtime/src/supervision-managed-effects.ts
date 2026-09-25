import { createHash } from "node:crypto";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecution,
} from "@lervo/application-contract";
import { codexStoredLoginEnvironment } from "@lervo/adapter-codex";
import { claudeStoredLoginEnvironment } from "@lervo/adapter-claude";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  supervisedManagedExecutionFields,
  observeManagedExecutionAbsenceEvents,
} from "@lervo/work-controller";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { runSupervisedManagedProcess } from "./supervision-managed-process.js";
import { supervisionClaimDuration } from "./supervision-claim-duration.js";
import { admitSupervisedManagedInvocation } from "./supervision-managed-admission.js";
import { supersedeUnstartedManagedExecution } from "./supervision-managed-supersession.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";

export interface NodeSupervisedManagedConfiguration {
  nodeExecutable: string;
  cliBundle: string;
}

/** Concrete managed dispatch against exact CAS effects and the same configured stored-login profile. */
export class SupervisionManagedEffects {
  private readonly cancellation = new AbortController();
  private readonly configuration: NodeSupervisedManagedConfiguration;
  private readonly readiness: NodeRuntimeReadinessConfiguration;

  constructor(
    private readonly repositoryRoot: string,
    configuration: NodeSupervisedManagedConfiguration,
    readiness: NodeRuntimeReadinessConfiguration,
    private readonly now: () => string,
  ) {
    this.configuration = structuredClone(configuration);
    this.readiness = structuredClone(readiness);
  }

  async execute(plan: OperatingActionPlanV1, fence: NodeSupervisionEffectSession) {
    const storage = await openProjectStorage(this.repositoryRoot);
    try {
      const effect = await this.readEffect(storage, plan);
      const context = this.readiness.providerLoginContexts?.[effect.provider];
      const providerExecutable = this.readiness.providerExecutables[effect.provider];
      if (context === undefined || providerExecutable === undefined)
        throw new Error("The managed provider has no exact configured login and executable.");
      const invocation = fence.managedInvocation(plan, effect);
      // A run that outlives its claim window keeps the exact lease alive; the plan deadline and
      // the responsibility completion deadline still bound every renewal. The first renewal
      // happens before launch so a late dispatch cannot expire before the first periodic check.
      const renewLease = async () => {
        let leaseDurationMs: number;
        try {
          leaseDurationMs = supervisionClaimDuration(effect.responsibility, this.now());
        } catch {
          return;
        }
        await fence.renewWorkerLease({
          assignmentId: effect.responsibility.assignmentId,
          agentId: effect.responsibility.executorAgentId,
          leaseId: effect.leaseId,
          leaseDurationMs,
        });
      };
      await renewLease();
      return await runSupervisedManagedProcess({
        repositoryRoot: this.repositoryRoot,
        invocation,
        configuration: {
          ...this.configuration,
          providerExecutable,
          environment:
            effect.provider === "codex"
              ? codexStoredLoginEnvironment(context)
              : claudeStoredLoginEnvironment(context),
        },
        events: storage.events,
        fence,
        now: this.now,
        signal: this.cancellation.signal,
        onRevalidationFailure: (reason) =>
          process.stderr.write(
            `Lervo managed worker revalidation failed: ${(reason instanceof Error ? reason.message : String(reason)).replace(/[\r\n\0]+/gu, " ").slice(0, 300)}\n`,
          ),
        revalidate: async () => {
          await admitSupervisedManagedInvocation({
            storage,
            invocation,
            now: this.now,
            commit: () => undefined,
          });
          await renewLease();
        },
      });
    } finally {
      await storage.close();
    }
  }

  stop(): void {
    this.cancellation.abort();
  }

  async supersede(
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionEffectSession, "commit">,
    binding: NodeSupervisionBinding,
  ) {
    if ((await this.inspect(plan)).status !== "not_started") return false;
    return supersedeUnstartedManagedExecution({
      repositoryRoot: this.repositoryRoot,
      binding,
      plan,
      sourceRevisionDigest,
      session,
      now: this.now,
    });
  }

  private async readEffect(storage: ProjectStorage, plan: OperatingActionPlanV1) {
    const bytes = await storage.artifacts.get(`lervo-cas://sha256/${plan.effectHash.slice(7)}`);
    if (
      bytes.byteLength > 256 * 1024 ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== plan.effectHash
    )
      throw new Error("The managed effect artifact is unavailable or corrupt.");
    const effect = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as SupervisedManagedExecution;
    const fields = supervisedManagedExecutionFields(effect);
    for (const [key, value] of Object.entries(fields))
      if (
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1])
      )
        throw new Error("The managed effect differs from its admitted plan.");
    return effect;
  }

  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.repositoryRoot);
    try {
      const effect = await this.readEffect(storage, plan);
      const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
      const events = collectRunEventsBounded({
        events: storage.events,
        runId: identity.runId,
        maximumEvents: 4096,
      });
      if (observeManagedExecutionAbsenceEvents(plan, events) !== null)
        return { status: "not_started" as const };
      const reservation = events.find(
        (event) =>
          event.type === "managed.execution.reserved" &&
          event.payload.executionKey === operatingContractHash(plan),
      );
      const requested = events.find((event) => event.type === "run.requested");
      const causal = events.find((event) => event.type === "work.causality.recorded");
      if (
        reservation === undefined ||
        requested === undefined ||
        causal === undefined ||
        causal.payload.assignmentId !== effect.responsibility.assignmentId ||
        causal.payload.workstreamId !== plan.workstreamId
      )
        return { status: "uncertain" as const };
      return {
        status: "confirmed" as const,
        eventIds: [reservation.eventId, requested.eventId],
      };
    } finally {
      await storage.close();
    }
  }
}

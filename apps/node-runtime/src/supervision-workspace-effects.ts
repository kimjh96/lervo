import { recoverPreparedWorkspace } from "./supervision-workspace-recovery.js";
import { supersedeUnstartedWorkspacePreparation } from "./supervision-workspace-supersession.js";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { applyWorkspaceProvision } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  assertSupervisionWorkspaceLocation,
  readCanonicalWorkspacePreparation,
} from "./supervision-workspace-plan.js";
import {
  inspectSupervisionWorkspaceReceipt,
  recordSupervisionWorkspaceReceipt,
} from "./supervision-workspace-receipt.js";

/** Prepares only an admitted Git host coordinate; authority loss retains recovery evidence. */
export class SupervisionWorkspaceEffects {
  private readonly configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>;
  private readonly binding: NodeSupervisionBinding;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
    this.configuration = structuredClone(configuration);
  }
  async assertReady(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalWorkspacePreparation({
        storage,
        source,
        plan,
        now: this.now,
      });
      await assertSupervisionWorkspaceLocation(this.root, basis.provision, this.configuration);
    } finally {
      await storage.close();
    }
  }
  supersede(
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    return supersedeUnstartedWorkspacePreparation({
      repositoryRoot: this.root,
      binding: this.binding,
      configuration: this.configuration,
      plan,
      sourceRevisionDigest,
      session,
      now: this.now,
    });
  }
  async inspect(
    plan: OperatingActionPlanV1,
    session?: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const result = await inspectSupervisionWorkspaceReceipt(storage, plan);
      if (result.status === "not_started") {
        const now = Date.parse(this.now());
        if (!Number.isFinite(now) || now < Date.parse(plan.deadline))
          return { status: "uncertain" as const };
      }
      if (result.status !== "uncertain" || session === undefined) return result;
      return await recoverPreparedWorkspace({
        storage,
        binding: this.binding,
        plan,
        configuration: this.configuration,
        session,
        now: this.now,
      });
    } finally {
      await storage.close();
    }
  }
  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    const storage = await openProjectStorage(this.root);
    try {
      const source = new SupervisionTaskSource(storage, this.binding, this.now);
      const initial = await readCanonicalWorkspacePreparation({
        storage,
        source: await source.read(operatingDecisionId(plan)),
        plan,
        now: this.now,
      });
      const revalidate = async () => {
        const tasks = await source.read(operatingDecisionId(plan));
        const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
        if (
          !authority.source.eligible ||
          authority.installation.revoked ||
          operatingContractHash({
            authorityDigest: authority.source.sourceRevisionDigest,
            taskDigest: tasks.sourceRevisionDigest,
          }) !== plan.sourceRevisionDigest ||
          Date.parse(this.now()) >=
            Math.min(
              Date.parse(plan.deadline),
              Date.parse(authority.installation.mandate.expiresAt),
            )
        )
          throw new Error("The workspace preparation authority changed.");
        const fresh = await readCanonicalWorkspacePreparation({
          storage,
          source: tasks,
          plan,
          now: this.now,
        });
        await assertSupervisionWorkspaceLocation(this.root, fresh.provision, this.configuration);
        session.commit(() => {
          if (storage.events.latest()?.eventHash !== tasks.headEventHash)
            throw new Error("The workspace preparation event source changed.");
        });
      };
      await revalidate();
      await applyWorkspaceProvision({
        plan: initial.provision,
        host: new GitWorkspaceHostAdapter(revalidate),
        now: new Date(this.now()),
        revalidate,
        recordApplied: async () => {
          await revalidate();
          await recordSupervisionWorkspaceReceipt({
            storage,
            plan,
            now: this.now,
            commit: session.commit,
          });
        },
      });
      const result = await inspectSupervisionWorkspaceReceipt(storage, plan);
      if (result.status !== "confirmed")
        throw new Error("The workspace preparation requires reconciliation.");
      return { eventIds: result.eventIds };
    } finally {
      await storage.close();
    }
  }
}

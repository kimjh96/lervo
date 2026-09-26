import { supervisionReasoningDecisionSchema } from "./supervision-reasoning-operations.js";
import { inspectCodexLogin, inspectCodexRuntime } from "@lervo/adapter-codex";
import { inspectClaudeLogin, inspectClaudeRuntime } from "@lervo/adapter-claude";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { SupervisionPreflightError } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readInterruptedOwnerResourceSource } from "./supervision-interrupted-owner-resources.js";
import { readCanonicalOwnerReasoning } from "./supervision-reasoning-source.js";
import { inspectOwnerReasoning } from "./supervision-reasoning-receipt.js";
import { runManagedOwnerReasoning } from "./supervision-reasoning-run.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { supersedeUnstartedOwnerReasoning } from "./supervision-reasoning-supersession.js";
import { readOwnerSpendAdmission } from "./supervision-owner-spend-source.js";
import { NodeSupervisionError } from "./supervision-authority.js";
import { OWNER_REASONING_WINDOW_MS } from "./supervision-native-owner.js";

export interface NodeOwnerReasoningConfiguration {
  provider: "codex" | "claude";
  model?: string;
  reservedTokens: number;
}

/** Owns one native model invocation and its cancellation, isolated profile and durable replay boundary. */
export class SupervisionOwnerReasoningEffects {
  private readonly binding: NodeSupervisionBinding;
  private readonly configuration: NodeOwnerReasoningConfiguration;
  private readonly readiness: NodeRuntimeReadinessConfiguration;
  private readonly cancellation = new AbortController();
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    configuration: NodeOwnerReasoningConfiguration,
    readiness: NodeRuntimeReadinessConfiguration,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
    this.configuration = structuredClone(configuration);
    this.readiness = structuredClone(readiness);
    if (
      !["codex", "claude"].includes(configuration.provider) ||
      !Number.isSafeInteger(configuration.reservedTokens) ||
      configuration.reservedTokens < 1 ||
      (configuration.model !== undefined &&
        (configuration.model.length < 1 ||
          configuration.model.length > 128 ||
          /[\r\n\0]/u.test(configuration.model)))
    )
      throw new Error("The owner reasoning configuration is invalid.");
  }
  stop() {
    this.cancellation.abort();
  }
  supersede(
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    return supersedeUnstartedOwnerReasoning({
      repositoryRoot: this.root,
      binding: this.binding,
      plan,
      sourceRevisionDigest,
      session,
      now: this.now,
    });
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      return await inspectOwnerReasoning(storage, plan);
    } finally {
      await storage.close();
    }
  }
  async assertReady(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalOwnerReasoning({
        storage,
        binding: this.binding,
        source,
        plan,
        now: this.now,
      });
      const { provider } = basis.effect;
      const executable = this.readiness.providerExecutables[provider];
      const context = this.readiness.providerLoginContexts?.[provider];
      if (
        provider !== this.configuration.provider ||
        basis.effect.requestedModel !== (this.configuration.model ?? null) ||
        basis.effect.reservedTokens !==
          Math.max(
            this.configuration.reservedTokens,
            basis.context.facts.mandate.maximumAttemptTokens,
          ) ||
        executable === undefined ||
        context === undefined
      )
        throw new Error("The owner reasoning effect differs from its configured native profile.");
      const at = this.now();
      const [runtime, login] = await Promise.all(
        provider === "codex"
          ? [inspectCodexRuntime(executable), inspectCodexLogin(executable, context)]
          : [inspectClaudeRuntime(executable), inspectClaudeLogin(executable, context)],
      );
      const age = Date.parse(this.now()) - Date.parse(at);
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age > 5000 ||
        runtime.status !== "available" ||
        login.status !== "login_present"
      )
        throw new Error("The owner reasoning native runtime or login is not ready.");
      return { basis, executable, loginContext: context };
    } finally {
      await storage.close();
    }
  }
  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    const ready = await this.assertReady(plan);
    const storage = await openProjectStorage(this.root);
    const cancellation = new AbortController();
    const stop = () => cancellation.abort();
    this.cancellation.signal.addEventListener("abort", stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let audit: ReturnType<typeof setInterval> | undefined;
    let checking: Promise<void> | null = null;
    try {
      if (this.cancellation.signal.aborted)
        throw new Error("The owner reasoning runtime is closed.");
      const taskSource = new SupervisionTaskSource(storage, this.binding, this.now);
      const source = await taskSource.read(operatingDecisionId(plan));
      const history = new SupervisionAuthorityHistory(
        storage.events,
        storage.paths.eventDatabase,
        storage.manifest.projectId,
        () => Date.parse(this.now()),
      );
      const authority = await observeNodeSupervisionAuthority(
        storage,
        this.binding,
        this.now,
        history,
      );
      if (
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== plan.sourceRevisionDigest
      )
        throw new Error("The owner reasoning source changed before reservation.");
      await readAdmittedControlDecision(storage, plan);
      try {
        const spend = await readOwnerSpendAdmission({
          mandate: authority.installation.mandate,
          plan,
          events: source.events,
          artifacts: storage.artifacts,
        });
        if (spend?.disposition === "exceeded")
          throw new NodeSupervisionError("supervision_owner_spend_exceeded");
      } catch (cause) {
        throw new SupervisionPreflightError({ cause });
      }
      const admissionHead = source.events.at(-1)?.eventHash;
      const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
      let authorityCheck = Promise.resolve();
      const revalidateAuthority = () =>
        (authorityCheck = authorityCheck.then(async () => {
          const current = await observeNodeSupervisionAuthority(
            storage,
            this.binding,
            this.now,
            history,
          );
          if (
            current.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
            Date.parse(this.now()) >= Date.parse(plan.deadline)
          )
            throw new Error("Owner reasoning authority changed during invocation.");
          session.commit(() => undefined);
        }));
      const remaining = Date.parse(plan.deadline) - Date.parse(this.now());
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > OWNER_REASONING_WINDOW_MS)
        throw new Error("The owner reasoning deadline exceeds its bounded invocation window.");
      timer = setTimeout(stop, remaining);
      timer.unref?.();
      session.commit(() =>
        storage.events.transact((transaction) => {
          if (storage.events.latest()?.eventHash !== admissionHead)
            throw new Error("The owner spend source changed before reservation.");
          if (
            collectRunEventsBounded({
              events: storage.events,
              runId: identity.runId,
              maximumEvents: 4096,
            }).length > 0
          )
            throw new Error(
              "The owner reasoning execution key already exists; inspect it before retrying.",
            );
          const result = transaction.append({
            eventId: `evt_${operatingContractHash({ kind: "managed.execution.reserved", ...identity }).slice(7, 39)}`,
            projectId: plan.projectId,
            ...identity,
            schemaVersion: 3,
            type: "managed.execution.reserved",
            occurredAt: this.now(),
            actor: { kind: "system" },
            policyVersion: operatingContractHash({ contract: "work.owner_reasoning.v1" }),
            payload: { executionKey: operatingContractHash(plan), requestHash: plan.effectHash },
          });
          if (result.redactions.length > 0)
            throw new Error("Owner reasoning reservation evidence was redacted.");
        }),
      );
      audit = setInterval(() => {
        if (checking !== null) return;
        checking = revalidateAuthority()
          .catch(stop)
          .finally(() => {
            checking = null;
          });
      }, 1000);
      audit.unref?.();
      const adapter = createNodeProviderAdapter({
        provider: ready.basis.effect.provider,
        repositoryRoot: this.root,
        executable: ready.executable,
        loginContext: ready.loginContext,
        resolveArtifact: (uri) => storage.artifacts.get(uri),
        ...(ready.basis.effect.requestedModel === null
          ? {}
          : { model: ready.basis.effect.requestedModel }),
        requestTimeoutMs: remaining,
        structuredOutputSchema: supervisionReasoningDecisionSchema(ready.basis.context),
      });
      await runManagedOwnerReasoning({
        storage,
        plan,
        ...ready.basis,
        adapter,
        session,
        signal: cancellation.signal,
        now: this.now,
        revalidate: async () => {
          await revalidateAuthority();
          const current = await taskSource.read(operatingDecisionId(plan));
          const spend = await readOwnerSpendAdmission({
            mandate: authority.installation.mandate,
            plan,
            events: current.events,
            artifacts: storage.artifacts,
          });
          if (spend?.disposition === "exceeded")
            throw new NodeSupervisionError("supervision_owner_spend_exceeded");
          await readCanonicalOwnerReasoning({
            storage,
            source: current,
            binding: this.binding,
            plan,
            now: this.now,
          });
          const { workstreamResources: resources } = await readInterruptedOwnerResourceSource({
            storage,
            events: current.events.filter((event) => event.runId !== identity.runId),
            workstreamId: plan.workstreamId,
            ...(current.scopeAnchor === undefined ? {} : { scopeAnchor: current.scopeAnchor }),
          });
          if (
            operatingContractHash(resources) !== operatingContractHash(source.workstreamResources)
          )
            throw new Error("The owner reasoning budget source changed before provider startup.");
        },
      });
      const result = await inspectOwnerReasoning(storage, plan);
      if (result.status !== "confirmed")
        throw new Error("The owner reasoning invocation requires inspection.");
      return { eventIds: result.eventIds };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (audit !== undefined) clearInterval(audit);
      await checking;
      this.cancellation.signal.removeEventListener("abort", stop);
      await storage.close();
    }
  }
}

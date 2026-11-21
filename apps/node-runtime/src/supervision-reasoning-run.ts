import { hostOutcomeTask, observeHostContextOutcomes } from "@lervo/repository-context";
import { ownerReasoningTurn } from "./supervision-reasoning-instructions.js";
import { discoverInstructionDocuments } from "@lervo/context";
import { randomBytes } from "node:crypto";
import { loadDocumentRegistry } from "@lervo/project";
import { ManagedProviderRunCoordinator, type ManagedWorkCausalityInput } from "@lervo/orchestrator";
import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { RoleProfile } from "@lervo/schemas";
import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";

/** Executes an already-admitted owner turn with ordinary managed context and usage evidence. */
export async function runManagedOwnerReasoning(input: {
  storage: ProjectStorage;
  plan: OperatingActionPlanV1;
  effect: SupervisedOwnerReasoningV1;
  context: OwnerReasoningContext;
  workCausality: ManagedWorkCausalityInput;
  role: RoleProfile;
  adapter: ProviderAdapter;
  session: NodeSupervisionEffectSession;
  signal: AbortSignal;
  revalidate(): Promise<void>;
  now(): string;
}) {
  const { storage, plan, effect, context, session } = input;
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  const adapter = new Proxy(input.adapter, {
    get(target, key) {
      if (key === "start")
        return async (request: Parameters<ProviderAdapter["start"]>[0]) => {
          await input.revalidate();
          if (input.signal.aborted)
            throw new Error("The owner reasoning invocation was cancelled.");
          let started: ReturnType<ProviderAdapter["start"]> | undefined;
          session.commit(() => {
            started = target.start(request);
            void started.catch(() => undefined);
          });
          return started!;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const coordinator = new ManagedProviderRunCoordinator({
    createEventId: () => `evt_${randomBytes(16).toString("hex")}`,
    adapter,
    coordinates: { projectId: plan.projectId, ...identity, roleId: effect.roleId },
    events: {
      list: (options) => storage.events.list(options),
      transact: (operation) => session.commit(() => storage.events.transact(operation)),
    },
    artifactStore: storage.artifacts,
    policyVersion: operatingContractHash({ contract: "work.owner_reasoning.v1" }),
    now: () => new Date(input.now()),
    deadlines: {
      providerTurnMs: Math.max(1, Date.parse(effect.deadline) - Date.parse(input.now())),
      snapshotMs: 30_000,
      adapterStopMs: 10_000,
    },
  });
  const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
  const instructions = await discoverInstructionDocuments({
    repositoryRoot: storage.paths.repositoryRoot,
    registry,
    expectedPaths: [],
  });
  const run = await coordinator.run({
    executionMode: "read_only",
    repositoryRoot: storage.paths.repositoryRoot,
    requestDigest: plan.effectHash,
    risk: "low",
    targetTurnId: `turn_${operatingContractHash(plan).slice(7, 39)}`,
    // ADR-0608: the context is repository and conversation data; the prose before it is Lervo's.
    ...ownerReasoningTurn(context, input.now()),
    context: {
      registry,
      role: input.role,
      expectedPaths: [],
      publications: [],
      handoffs: [],
      ...context.planning.delivery,
      documentRules: {
        "repository.instructions": instructions.map((document) => document.documentId),
      },
    },
    writingPolicy: null,
    resultFormat: "json",
    resolvedSkills: [],
    signal: input.signal,
    workCausality: input.workCausality,
  });
  await observeHostContextOutcomes({
    repositoryRoot: storage.paths.repositoryRoot,
    origin: "managed_run",
    effects: "read_only",
    coordinates: identity,
    task: hostOutcomeTask("Review current owner reasoning decision against the admitted plan.", []),
    artifacts: [
      {
        kind: "immutable",
        ...run.resultArtifact,
        readBytes: () => storage.artifacts.get(run.resultArtifact.uri),
      },
    ],
  });
  return run;
}

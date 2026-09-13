import {
  inspectNodeSupervisionEffect,
  executeNodeSupervisionEffect,
} from "./supervision-effect-routing.js";
import { createNodeSupervisionEffects } from "./supervision-runtime-effects.js";
import { SupervisionPeerCatalog } from "./supervision-peer-catalog.js";

import {
  readNodeDispatchReadiness,
  readNodeDispatchPreflight,
} from "./supervision-dispatch-readiness.js";
import { NativeSupervisionOwner } from "./supervision-native-owner.js";
import { openProjectStorage } from "@lervo/project-storage";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { SupervisionResultDelivery } from "./supervision-result-delivery.js";
import { snapshotRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { OutcomeSupervisionRuntime, type OutcomeSupervisionPorts } from "@lervo/orchestrator";
import {
  operatingContractHash,
  reviewOperatingAction,
  operatingReadinessKind,
  assertOwnerControlReadiness,
} from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";
import { NodeSupervisionStore, type NodeSupervisionSession } from "./supervision-store.js";
import { createSupervisionChangeLoop } from "./supervision-change-loop.js";
import { assertNodeSupervisionReadiness } from "./supervision-readiness.js";

import type {
  NodeSupervisionEffectSession,
  NodeOutcomeSupervisionRuntimeInput,
} from "./supervision-runtime-ports.js";
export type {
  NodeSupervisionEffectSession,
  NodeOutcomeSupervisionPorts,
  NodeCanonicalOutcomeSupervisionPorts,
  NodeNativeOutcomeSupervisionPorts,
} from "./supervision-runtime-ports.js";

/** Composes real repository authority and durable storage with explicit task/effect adapters. */
export async function openNodeOutcomeSupervisionRuntime(input: NodeOutcomeSupervisionRuntimeInput) {
  const configuration = snapshotRuntimeReadinessConfiguration(input.runtimeReadiness);
  if (
    (input.managedExecution !== undefined || input.ownerReasoning !== undefined) &&
    configuration === undefined
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  const effects = createNodeSupervisionEffects(input, configuration);
  const { handoffs, managed, topology, workspaces, hiring, reasoning } = effects;
  const binding = structuredClone(input.binding);
  const { ports } = input;
  if (!("propose" in ports) && input.ownerReasoning === undefined)
    throw new Error("Native owner planning requires configured owner reasoning.");
  const nativeOwner =
    input.ownerReasoning === undefined
      ? null
      : new NativeSupervisionOwner(
          input.repositoryRoot,
          binding,
          input.ownerReasoning,
          configuration!,
          ports.now,
          input.resultDelivery?.origin,
        );
  const store = await NodeSupervisionStore.open({
    repositoryRoot: input.repositoryRoot,
    binding,
    now: ports.now,
  });
  const deliveryStorage =
    input.resultDelivery === undefined
      ? null
      : await openProjectStorage(input.repositoryRoot).catch(async (error) => {
          await store.close();
          throw error;
        });
  const delivery =
    deliveryStorage === null
      ? null
      : new SupervisionResultDelivery(deliveryStorage, binding, input.resultDelivery!, ports.now);
  const peerStorage = await openProjectStorage(input.repositoryRoot).catch(async (error) => {
    await deliveryStorage?.close();
    await store.close();
    throw error;
  });
  let peers: SupervisionPeerCatalog;
  try {
    peers = new SupervisionPeerCatalog(peerStorage, binding, input.handoffPeers ?? [], ports.now);
  } catch (error) {
    await peerStorage.close();
    await deliveryStorage?.close();
    await store.close();
    throw error;
  }
  let current: NodeSupervisionSession | null = null;
  let mandateExpiresAt: number | null = null;
  let sourceBinding: { authorityDigest: string; taskDigest: string; combined: string } | null =
    null;
  const session = () => {
    if (current === null) throw new NodeSupervisionError("supervision_session_closed");
    return current;
  };
  const readAdmission: OutcomeSupervisionPorts["readAdmission"] = async (plan) => {
    if (plan.effectContract === "work.worker_hire.v1") {
      if (hiring === null) throw new Error("No trusted hiring readiness is configured.");
      await hiring.assertReady(plan);
    }
    const observation =
      "readAdmission" in ports
        ? await ports.readAdmission(plan)
        : await session().readTaskAdmission(plan);
    const authority = await session().readAuthority();
    const age = Date.parse(ports.now()) - Date.parse(authority.observedAt);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > 5000 ||
      sourceBinding === null ||
      authority.source.sourceRevisionDigest !== sourceBinding.authorityDigest ||
      observation.sourceRevisionDigest !== sourceBinding.taskDigest ||
      plan.sourceRevisionDigest !== sourceBinding.combined
    )
      throw new NodeSupervisionError("supervision_authority_changed");
    return {
      ...observation,
      sourceRevisionDigest: sourceBinding.combined,
      installedMandateHash: authority.installation.mandateHash,
      installationReviewHash: authority.installation.installationReviewHash,
      revocationCoordinate: authority.installation.mandate.revocationCoordinate,
      revoked: authority.installation.revoked || observation.revoked,
      ancestryValid: observation.ancestryValid,
      historyValid: observation.historyValid,
    };
  };
  const readOwnerControlReadiness: NonNullable<
    OutcomeSupervisionPorts["readOwnerControlReadiness"]
  > = async (plan) => {
    if (
      ["work.scoped_handoff.v1", "work.scoped_handoff_acceptance.v1"].includes(plan.effectContract)
    )
      await handoffs.assertReady(plan);
    if (plan.effectContract === "work.workspace_preparation.v1") {
      if (workspaces === null) throw new Error("No worker workspace host is configured.");
      await workspaces.assertReady(plan);
    }
    if (plan.effectContract === "work.owner_reasoning.v1") {
      if (reasoning === null) throw new Error("No native owner reasoning adapter is configured.");
      await reasoning.assertReady(plan);
    }
    if (["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract)) {
      if (delivery === null) throw new Error("No scoped result delivery adapter is installed.");
      await delivery.assertReady(plan);
    }
    const observed = await session().readOwnerControlReadiness(plan);
    if (
      sourceBinding === null ||
      observed.sourceRevisionDigest !== sourceBinding.taskDigest ||
      plan.sourceRevisionDigest !== sourceBinding.combined
    )
      throw new NodeSupervisionError("supervision_authority_changed");
    const observation = { ...observed, sourceRevisionDigest: sourceBinding.combined };
    assertOwnerControlReadiness({ plan, observation, now: ports.now() });
    return observation;
  };
  const dispatchReadinessInput = (plan: OperatingActionPlanV1) => ({
    repositoryRoot: input.repositoryRoot,
    plan,
    session: session(),
    ports,
    configuration,
    sourceBinding,
  });
  const readWorkerReadiness: OutcomeSupervisionPorts["readWorkerReadiness"] = (plan) =>
    readNodeDispatchReadiness(dispatchReadinessInput(plan));
  const runtime = new OutcomeSupervisionRuntime({
    ...ports,
    propose: (report) =>
      "propose" in ports ? ports.propose(report) : nativeOwner!.propose(report),
    withOwnerLease: async (id, operation) => {
      if (id !== binding.supervisionId)
        throw new NodeSupervisionError("supervision_binding_invalid");
      return store.withOwner(async (owner) => {
        current = owner;
        sourceBinding = null;
        try {
          await peers.refresh(owner);
          await delivery?.runPending(owner);
          return await operation();
        } finally {
          current = null;
          sourceBinding = null;
        }
      });
    },
    readSnapshot: async (id) => {
      const snapshot =
        "readSnapshot" in ports
          ? await ports.readSnapshot(id)
          : {
              ...(await session().readTaskSnapshot()),
              deliveryRequired: delivery !== null,
            };
      const installation = await session().readMandate();
      mandateExpiresAt = Date.parse(installation.mandate.expiresAt);
      if (
        snapshot.supervisionId !== binding.supervisionId ||
        snapshot.workstreamId !== binding.workstreamId ||
        snapshot.ownerAgentId !== binding.ownerAgentId ||
        snapshot.mandateHash !== binding.mandateHash ||
        !installation.mandate.projectIds.includes(snapshot.projectId)
      )
        throw new NodeSupervisionError("supervision_binding_invalid");
      try {
        const authority = await session().readRecoveryAuthority();
        if (
          snapshot.workstreamRevision !== authority.source.workstreamRevision ||
          !authority.source.causationEventIds.every((id) => snapshot.causationEventIds.includes(id))
        )
          return { ...snapshot, evidenceStatus: "conflict" };
        const digests = {
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: snapshot.sourceRevisionDigest,
        };
        sourceBinding = { ...digests, combined: operatingContractHash(digests) };
        return {
          ...snapshot,
          sourceRevisionDigest: sourceBinding.combined,
          authorityStatus: installation.revoked
            ? "revoked"
            : Date.parse(ports.now()) >= mandateExpiresAt
              ? "expired"
              : snapshot.authorityStatus,
        };
      } catch {
        return { ...snapshot, authorityStatus: "unobserved", evidenceStatus: "unavailable" };
      }
    },
    readMandate: async (hash) => {
      const installed = await session().readMandate();
      if (hash !== installed.mandateHash)
        throw new NodeSupervisionError("supervision_binding_invalid");
      return installed.mandate;
    },
    readAdmission,
    reconcileCancellation: (snapshot) => session().reconcileCancellation(snapshot),
    readWorkerReadiness,
    readOwnerControlReadiness,
    inspectEffect: (plan, receipt) =>
      inspectNodeSupervisionEffect({ effects, delivery, ports, plan, receipt, session: session() }),
    supersedeNotStarted: async (plan, digest) =>
      plan.effectContract === "assignment.topology.materialize.v1"
        ? topology.supersede(plan, digest, session())
        : plan.effectContract === "work.owner_reasoning.v1" && reasoning !== null
          ? reasoning.supersede(plan, digest, session())
          : plan.effectContract === "work.workspace_preparation.v1" && workspaces !== null
            ? workspaces.supersede(plan, digest, session())
            : ["work.managed_execution.v1", "work.managed_execution.v2"].includes(
                  plan.effectContract,
                ) && managed !== null
              ? managed.supersede(plan, digest, session(), input.binding)
              : "supersedeNotStarted" in ports
                ? (ports.supersedeNotStarted?.(plan, digest, session()) ?? false)
                : false,
    findPendingPlan: async () => session().findPendingPlan(),
    recordDecision: async (plan, review) => {
      if (sourceBinding === null)
        throw new NodeSupervisionError("supervision_authority_unavailable");
      return session().recordDecision(plan, review, sourceBinding.authorityDigest);
    },
    findDecision: async (id) => session().findDecision(id),
    recordEffect: async (receipt) => session().recordEffect(receipt),
    execute: async (plan) => {
      if (operatingReadinessKind(plan) === "owner_control") await readOwnerControlReadiness(plan);
      const preflight =
        operatingReadinessKind(plan) === "worker"
          ? await readNodeDispatchPreflight({
              ...dispatchReadinessInput(plan),
              readAdmission: () => readAdmission(plan),
            })
          : null;
      const readiness = preflight?.readiness ?? null;
      const snapshot = preflight?.admission ?? (await readAdmission(plan));
      const age = Date.parse(ports.now()) - Date.parse(snapshot.observedAt);
      const installation = await session().readMandate();
      const review = reviewOperatingAction({ mandate: installation.mandate, plan, snapshot });
      if (!Number.isFinite(age) || age < 0 || age > 5000 || review.disposition !== "admitted")
        throw new NodeSupervisionError("supervision_authority_changed");
      if (readiness !== null)
        assertNodeSupervisionReadiness({
          readiness,
          sourceRevisionDigest: snapshot.sourceRevisionDigest,
          now: ports.now(),
        });
      const owner = session();
      const authorityDigest = sourceBinding?.authorityDigest;
      if (authorityDigest === undefined)
        throw new NodeSupervisionError("supervision_authority_unavailable");
      const effectSession: NodeSupervisionEffectSession = {
        recordGoalCompletion: (action, effect) =>
          owner.recordGoalCompletion(action, effect, authorityDigest),
        commit: owner.commit,
        renew: owner.renew,
        recordArtifactReview: (action, effect) =>
          owner.recordArtifactReview(action, effect, authorityDigest),
        managedInvocation: (action, effect) =>
          owner.managedInvocation(action, effect, authorityDigest),
        claimResponsibility: (claim, revalidate) =>
          owner.claimResponsibility(claim, authorityDigest, revalidate),
        materializeTopology: (effect, action, currentTopology, revalidate) =>
          owner.materializeTopology(effect, action, authorityDigest, currentTopology, revalidate),
      };
      return executeNodeSupervisionEffect({
        effects,
        delivery,
        ports,
        plan,
        review,
        owner,
        effectSession,
        authorityDigest,
      });
    },
  });
  const runCycle = () => runtime.runCycle(binding.supervisionId);
  let loop: ReturnType<typeof createSupervisionChangeLoop> | null = null;
  let closed = false;
  return {
    runCycle,
    start(
      options: Pick<Parameters<typeof createSupervisionChangeLoop>[0], "onFailure" | "onCycle">,
    ): void {
      if (closed) throw new NodeSupervisionError("supervision_session_closed");
      if (loop !== null) return;
      loop = createSupervisionChangeLoop({
        ...options,
        runCycle,
        subscribe: (notify) => {
          const stopLocal = store.subscribe(notify);
          const stopPeers = peers.subscribe(notify);
          return () => {
            stopLocal();
            stopPeers();
          };
        },
        nextAuthorityCheckAt: () => {
          const futureExpiry =
            mandateExpiresAt !== null && mandateExpiresAt > Date.parse(ports.now())
              ? mandateExpiresAt
              : null;
          const candidates = [
            futureExpiry,
            store.nextAuthorityAuditAt(),
            peers.nextAuditAt(),
          ].filter((value): value is number => value !== null);
          return candidates.length === 0 ? null : Math.min(...candidates);
        },
      });
      loop.start();
    },
    close: async () => {
      closed = true;
      managed?.stop();
      reasoning?.stop();
      await loop?.stop();
      await store.close();
      await peers.close();
      await peerStorage.close();
      await deliveryStorage?.close();
    },
  };
}

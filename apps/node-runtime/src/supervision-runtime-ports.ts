import type { NodeOwnerReasoningConfiguration } from "./supervision-reasoning-effects.js";
import type { NodeSupervisionResultDeliveryConfiguration } from "./supervision-result-delivery.js";
import type { NodeSupervisedManagedConfiguration } from "./supervision-managed-effects.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type { NodeSupervisionPeerConfiguration } from "./supervision-peer-source.js";

type ApplicationPorts = Omit<
  OutcomeSupervisionPorts,
  | "withOwnerLease"
  | "reconcileCancellation"
  | "readMandate"
  | "findPendingPlan"
  | "recordDecision"
  | "findDecision"
  | "recordEffect"
  | "execute"
  | "inspectEffect"
  | "supersedeNotStarted"
  | "readOwnerControlReadiness"
>;

export interface NodeSupervisionEffectSession extends Pick<
  NodeSupervisionSession,
  "commit" | "renew" | "renewWorkerLease"
> {
  recordGoalCompletion(
    plan: Parameters<NodeSupervisionSession["recordGoalCompletion"]>[0],
    effect: Parameters<NodeSupervisionSession["recordGoalCompletion"]>[1],
  ): ReturnType<NodeSupervisionSession["recordGoalCompletion"]>;
  recordArtifactReview(
    plan: Parameters<NodeSupervisionSession["recordArtifactReview"]>[0],
    effect: Parameters<NodeSupervisionSession["recordArtifactReview"]>[1],
  ): ReturnType<NodeSupervisionSession["recordArtifactReview"]>;
  managedInvocation(
    plan: Parameters<NodeSupervisionSession["managedInvocation"]>[0],
    effect: Parameters<NodeSupervisionSession["managedInvocation"]>[1],
  ): ReturnType<NodeSupervisionSession["managedInvocation"]>;
  claimResponsibility(
    input: Parameters<NodeSupervisionSession["claimResponsibility"]>[0],
    revalidate: Parameters<NodeSupervisionSession["claimResponsibility"]>[2],
  ): ReturnType<NodeSupervisionSession["claimResponsibility"]>;
  materializeTopology(
    effect: Parameters<NodeSupervisionSession["materializeTopology"]>[0],
    plan: Parameters<NodeSupervisionSession["materializeTopology"]>[1],
    currentTopology: Parameters<NodeSupervisionSession["materializeTopology"]>[3],
    revalidate: Parameters<NodeSupervisionSession["materializeTopology"]>[4],
  ): ReturnType<NodeSupervisionSession["materializeTopology"]>;
}

export interface NodeOutcomeSupervisionPorts extends ApplicationPorts {
  inspectEffect(
    plan: Parameters<OutcomeSupervisionPorts["inspectEffect"]>[0],
    receipt: Parameters<OutcomeSupervisionPorts["inspectEffect"]>[1],
    session: Pick<NodeSupervisionSession, "inspectTopology">,
  ): ReturnType<OutcomeSupervisionPorts["inspectEffect"]>;
  supersedeNotStarted?(
    plan: Parameters<OutcomeSupervisionPorts["inspectEffect"]>[0],
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionSession, "supersedeTopology">,
  ): Promise<boolean>;
  execute(
    plan: Parameters<OutcomeSupervisionPorts["execute"]>[0],
    review: Parameters<OutcomeSupervisionPorts["execute"]>[1],
    fence: NodeSupervisionEffectSession,
  ): ReturnType<OutcomeSupervisionPorts["execute"]>;
}

/** Omitting task ports selects the canonical repository snapshot and managed admission readers. */
export type NodeCanonicalOutcomeSupervisionPorts = Omit<
  NodeOutcomeSupervisionPorts,
  "readSnapshot" | "readAdmission" | "readWorkerReadiness"
>;

/** The native owner supplies planning and built-in effects; the host records bounded attention. */
export type NodeNativeOutcomeSupervisionPorts = Pick<
  NodeCanonicalOutcomeSupervisionPorts,
  "now" | "recordAttention"
>;

export interface NodeOutcomeSupervisionRuntimeInput {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  ports:
    | NodeOutcomeSupervisionPorts
    | NodeCanonicalOutcomeSupervisionPorts
    | NodeNativeOutcomeSupervisionPorts;
  runtimeReadiness?: NodeRuntimeReadinessConfiguration;
  managedExecution?: NodeSupervisedManagedConfiguration;
  resultDelivery?: NodeSupervisionResultDeliveryConfiguration;
  ownerReasoning?: NodeOwnerReasoningConfiguration;
  handoffPeers?: NodeSupervisionPeerConfiguration[];
}

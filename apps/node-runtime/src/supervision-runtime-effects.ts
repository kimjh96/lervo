import { SupervisionAssignmentAmendmentEffects } from "./supervision-assignment-amendment-effects.js";
import { SupervisionHandoffEffects } from "./supervision-handoff-effects.js";
import { SupervisionAttentionEffects } from "./supervision-attention-effects.js";
import { SupervisionAssignmentRecoveryEffects } from "./supervision-assignment-recovery-effects.js";
import { SupervisionWorkerHireEffects } from "./supervision-worker-hire-effects.js";
import { SupervisionAssignmentCompletionEffects } from "./supervision-assignment-completion-effects.js";
import { SupervisionWorkspaceEffects } from "./supervision-workspace-effects.js";
import { SupervisionTopologyEffects } from "./supervision-topology-effects.js";
import { SupervisionClaimEffects } from "./supervision-claim-effects.js";
import { SupervisionOwnerReasoningEffects } from "./supervision-reasoning-effects.js";
import { SupervisionOwnerControlEffects } from "./supervision-owner-control-effects.js";
import { SupervisionManagedEffects } from "./supervision-managed-effects.js";
import type { NodeOutcomeSupervisionRuntimeInput } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";

export function createNodeSupervisionEffects(
  input: NodeOutcomeSupervisionRuntimeInput,
  configuration: NodeRuntimeReadinessConfiguration | undefined,
) {
  const binding = structuredClone(input.binding);
  const ports = input.ports;
  const handoffs = new SupervisionHandoffEffects(
    input.repositoryRoot,
    binding,
    input.handoffPeers ?? [],
    ports.now,
  );
  const managed =
    input.managedExecution === undefined
      ? null
      : new SupervisionManagedEffects(
          input.repositoryRoot,
          input.managedExecution,
          configuration!,
          input.ports.now,
        );
  const topology = new SupervisionTopologyEffects(input.repositoryRoot, binding, ports.now);
  const workspaces =
    configuration?.workerWorkspace === undefined
      ? null
      : new SupervisionWorkspaceEffects(
          input.repositoryRoot,
          binding,
          configuration.workerWorkspace,
          ports.now,
        );
  const completions = new SupervisionAssignmentCompletionEffects(
    input.repositoryRoot,
    binding,
    ports.now,
  );
  const hiring =
    configuration === undefined
      ? null
      : new SupervisionWorkerHireEffects(input.repositoryRoot, binding, configuration, ports.now);
  const recoveries = new SupervisionAssignmentRecoveryEffects(
    input.repositoryRoot,
    binding,
    ports.now,
  );
  const amendments = new SupervisionAssignmentAmendmentEffects(
    input.repositoryRoot,
    binding,
    ports.now,
  );
  const claims = new SupervisionClaimEffects(input.repositoryRoot, binding, ports.now);
  const reasoning =
    input.ownerReasoning === undefined
      ? null
      : new SupervisionOwnerReasoningEffects(
          input.repositoryRoot,
          binding,
          input.ownerReasoning,
          configuration!,
          ports.now,
        );
  const ownerControls = new SupervisionOwnerControlEffects(
    input.repositoryRoot,
    binding,
    ports.now,
  );
  return {
    attention: new SupervisionAttentionEffects(input.repositoryRoot, binding, ports.now),
    handoffs,
    managed,
    topology,
    workspaces,
    completions,
    hiring,
    recoveries,
    amendments,
    claims,
    reasoning,
    ownerControls,
  };
}

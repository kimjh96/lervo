import { randomUUID } from "node:crypto";
import {
  applyWorkspaceIntegrationCandidate,
  planWorkspaceIntegrationCandidate,
  verifyWorkspaceIntegrationCandidate,
  completeWorkspaceIntegration,
  captureRepositorySnapshot,
} from "@lervo/orchestrator";
import { GitWorkspaceIntegrationAdapter } from "@lervo/workspace-host-git";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { canonicalJson, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { provisionCanonicalWorkspace } from "./canonical-workspace.js";
import { convergenceEffectCheckpoint } from "./effect-checkpoint.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import { closeIntegratedConvergenceWorkspace } from "./integrator-workspace-closure.js";
import { nextConvergenceIntegrationGeneration } from "./integration-target-generation.js";

export async function prepareCanonicalGitIntegration(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  authority: ConvergenceAssignmentAuthority,
  sealedWorkspaceId: string,
) {
  const root = context.storage.paths.repositoryRoot;
  const provision = await provisionCanonicalWorkspace(context, authority, "integrator");
  const integrationHost = new GitWorkspaceIntegrationAdapter(provision.host);
  const suites = await Promise.all(
    authority.delegation.verification.map((required) =>
      loadVerificationSuite(root, required.suiteId),
    ),
  );
  const plan = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_plan",
    prepare: async () =>
      planWorkspaceIntegrationCandidate({
        repositoryRoot: root,
        integrationWorkspacePath: provision.path,
        integrationWorkspaceId: provision.workspace.workspaceId,
        integratorAgentId: authority.agent.agentId,
        integratorWriterSessionId: provision.sessionId,
        leaseId: authority.assignment.lease!.leaseId,
        provider: context.provider,
        targetRef: authority.delegation.integrationTarget.ref,
        targetGeneration: await nextConvergenceIntegrationGeneration(
          root,
          authority.delegation.integrationTarget.ref,
        ),
        verificationSuites: suites,
        selectedWorkspaceIds: [sealedWorkspaceId],
        strategies: { [sealedWorkspaceId]: "fast_forward" },
        integrationHost,
      }),
  });
  await authority.assertCurrent();
  context.assertSource(state);
  await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_candidate",
    prepare: () => applyWorkspaceIntegrationCandidate({ plan, integrationHost }),
  });
  const verificationReceipt = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_verification",
    prepare: () =>
      verifyWorkspaceIntegrationCandidate({
        plan,
        integrationHost,
        suites,
        artifactStore: context.storage.artifacts,
        verifier: {
          verify: async (input) =>
            runVerificationSuite({
              suite: input.suite,
              repositoryRoot: input.repositoryRoot,
              repositoryRevision: input.repositoryRevision,
              captureRepositoryRevision: async (target) =>
                (await captureRepositorySnapshot(target)).revision,
              artifactStore: context.storage.artifacts,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            }),
        },
        append: (specs) => {
          context.storage.events.transact((transaction) => {
            for (const spec of specs) {
              const id = randomUUID().replaceAll("-", "");
              transaction.append({
                ...spec,
                eventId: spec.eventId ?? `evt_${id}`,
                schemaVersion: 4,
                projectId: state.baseline.projectId,
                runId: `run_${id}`,
                sessionId: `ses_${id}`,
                policyVersion: state.baseline.policyHash,
              });
            }
          });
        },
        signal: context.signal,
      }),
  });
  await authority.assertCurrent();
  context.assertSource(state);
  const integration = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_completion",
    prepare: () =>
      completeWorkspaceIntegration({
        plan,
        verificationReceipt,
        integrationHost,
      }),
  });
  const observedIntegration = await completeWorkspaceIntegration({
    plan,
    verificationReceipt,
    integrationHost,
  });
  if (canonicalJson(observedIntegration) !== canonicalJson(integration))
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  await closeIntegratedConvergenceWorkspace(
    context,
    authority,
    plan,
    verificationReceipt,
    integration,
  );
  return { plan, integration };
}

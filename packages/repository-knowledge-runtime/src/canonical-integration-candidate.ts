import { randomUUID } from "node:crypto";
import {
  applyWorkspaceIntegrationCandidate,
  planWorkspaceIntegrationCandidate,
  verifyWorkspaceIntegrationCandidate,
  completeWorkspaceIntegration,
} from "@lervo/orchestrator";
import { GitWorkspaceIntegrationAdapter } from "@lervo/workspace-host-git";
import { canonicalJson, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { provisionCanonicalWorkspace } from "./canonical-workspace.js";
import { convergenceEffectCheckpoint } from "./effect-checkpoint.js";
import {
  captureGitKeptSnapshot,
  observedRepositorySnapshot,
  withVerificationSourceChanges,
} from "./verification-source-changes.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import { closeIntegratedConvergenceWorkspace } from "./integrator-workspace-closure.js";
import { nextConvergenceIntegrationGeneration } from "./integration-target-generation.js";
import { releaseConvergenceIntegrationAttempt } from "./integration-attempt-release.js";
import { integrationVerificationFailure } from "./integration-verification-failure.js";
import {
  runConvergenceVerificationSuite,
  verificationEnvironment,
} from "./verification-environment.js";
import { loadConvergenceSuite } from "./default-knowledge-suite.js";

/**
 * A candidate that failed verification never moves the target, so its lease releases the attempt
 * before the failure propagates; otherwise the attempt would block every later target generation.
 * A refused release leaves the attempt blocking, and the original failure still propagates.
 */
async function releaseFailedCandidate(
  root: string,
  plan: { targetRef: string; attempt: { targetLeaseId: string } },
  authority: ConvergenceAssignmentAuthority,
  error: unknown,
): Promise<never> {
  await releaseConvergenceIntegrationAttempt({
    root,
    ref: plan.targetRef,
    targetLeaseId: plan.attempt.targetLeaseId,
    holderLeaseId: authority.assignment.lease!.leaseId,
  }).catch(() => false);
  throw error;
}

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
      loadConvergenceSuite(root, required.suiteId),
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
          authority.assignment.lease!.leaseId,
        ),
        verificationSuites: suites,
        selectedWorkspaceIds: [sealedWorkspaceId],
        strategies: { [sealedWorkspaceId]: "fast_forward" },
        integrationHost,
      }),
  });
  await authority.assertCurrent();
  context.assertSourceExact(state);
  await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_candidate",
    prepare: () => applyWorkspaceIntegrationCandidate({ plan, integrationHost }),
  });
  context.sourceObservation?.noteChange();
  // The integrator's suite runs with the same login-shell PATH as every other convergence suite
  // (ADR-0536): under a service manager's minimal PATH, `pnpm` is missing.
  const environment = await verificationEnvironment();
  const verificationFailure = integrationVerificationFailure(suites.length);
  const verificationReceipt = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integration_verification",
    prepare: () =>
      verifyWorkspaceIntegrationCandidate({
        plan,
        integrationHost,
        suites,
        captureSnapshot: captureGitKeptSnapshot,
        artifactStore: context.storage.artifacts,
        verifier: {
          verify: async (input) => {
            const observed = await withVerificationSourceChanges(
              context.storage.artifacts,
              observedRepositorySnapshot,
              (captureRepositoryRevision) =>
                runConvergenceVerificationSuite(
                  {
                    suite: input.suite,
                    repositoryRoot: input.repositoryRoot,
                    repositoryRevision: input.repositoryRevision,
                    captureRepositoryRevision,
                    artifactStore: context.storage.artifacts,
                    ...(input.signal === undefined ? {} : { signal: input.signal }),
                  },
                  environment,
                ),
            );
            verificationFailure.observe(observed.result, observed.resultArtifact.contentHash);
            return observed;
          },
        },
        append: (specs) => {
          verificationFailure.accept(specs);
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
  }).catch((error: unknown) =>
    releaseFailedCandidate(root, plan, authority, verificationFailure.classify(error)),
  );
  await authority.assertCurrent();
  context.assertSourceExact(state);
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
  context.sourceObservation?.noteChange();
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

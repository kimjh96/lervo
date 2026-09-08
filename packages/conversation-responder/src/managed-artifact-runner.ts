import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";

import { MemoryConversationProviderSessionRegistry } from "./provider-session.js";
import { validateConversationManagedRun } from "./run-validation.js";
import type {
  ManagedConversationArtifactRunnerOptions,
  ManagedConversationResponsePlan,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class ManagedConversationArtifactRunner {
  private readonly providerSessions;

  constructor(private readonly options: ManagedConversationArtifactRunnerOptions) {
    this.providerSessions =
      options.providerSessions ?? new MemoryConversationProviderSessionRegistry();
  }

  async run(input: {
    plan: ManagedConversationResponsePlan;
    requestDigest: string;
    instructions: string;
  }) {
    const coordinator = new ManagedProviderRunCoordinator({
      adapter: input.plan.adapter,
      coordinates: {
        projectId: this.options.projectId,
        runId: input.plan.runId,
        sessionId: input.plan.sessionId,
        roleId: input.plan.role.roleId,
      },
      policyVersion: this.options.policyVersion,
      events: this.options.events,
      artifactStore: this.options.artifactStore,
      ...(this.options.deadlines === undefined ? {} : { deadlines: this.options.deadlines }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(this.options.createEventId === undefined
        ? {}
        : { createEventId: this.options.createEventId }),
    });
    const run = await coordinator.run({
      repositoryRoot: this.options.repositoryRoot,
      requestDigest: input.requestDigest,
      risk: "low",
      instructions: input.instructions,
      targetTurnId: input.plan.targetTurnId,
      context: {
        registry: input.plan.registry,
        role: input.plan.role,
        expectedPaths: [...(input.plan.expectedPaths ?? [])],
        documentRules: input.plan.documentRules,
        ...(input.plan.additionalCandidates === undefined
          ? {}
          : { additionalCandidates: input.plan.additionalCandidates }),
        ...(input.plan.recommendationBatches === undefined
          ? {}
          : { recommendationBatches: input.plan.recommendationBatches }),
        ...(input.plan.graphRecommendations === undefined
          ? {}
          : { graphRecommendations: input.plan.graphRecommendations }),
        publications: input.plan.publications,
        handoffs: input.plan.handoffs,
      },
      writingPolicy: input.plan.writingPolicy,
      resolvedSkills: input.plan.resolvedSkills,
      workCausality: {
        relationship: "root",
        agentId: input.plan.executionIdentity.agentId,
      },
    });
    validateConversationManagedRun({
      run,
      events: this.options.events,
      requestDigest: input.requestDigest,
      agentId: input.plan.executionIdentity.agentId,
      roleId: input.plan.role.roleId,
      targetTurnId: input.plan.targetTurnId,
      publications: input.plan.publications,
    });
    let claimed: boolean;
    try {
      claimed = await this.providerSessions.claim({
        projectId: run.session.projectId,
        provider: run.session.provider,
        providerSessionId: run.session.providerSessionId,
        runId: run.session.runId,
        sessionId: run.session.sessionId,
        roleId: run.session.roleId,
      });
    } catch {
      claimed = false;
    }
    if (!claimed) {
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "No independent provider session was assigned to the conversation response role.",
      );
    }
    return run.resultArtifact;
  }
}

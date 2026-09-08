import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";

import { readConversationMessage } from "./message-artifact.js";
import { MemoryConversationProviderSessionRegistry } from "./provider-session.js";
import {
  conversationResponseInstructions,
  conversationResponseRequestDigest,
  validateConversationResponseRequest,
} from "./request.js";
import { publishConversationResponse } from "./response-publication.js";
import { validateConversationManagedRun } from "./run-validation.js";
import type {
  ManagedConversationResponsePlan,
  ManagedConversationResponseRequest,
  ManagedConversationResponderOptions,
  ManagedConversationResponderPort,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class ManagedConversationResponder implements ManagedConversationResponderPort {
  private readonly providerSessions;

  constructor(private readonly options: ManagedConversationResponderOptions) {
    this.providerSessions =
      options.providerSessions ?? new MemoryConversationProviderSessionRegistry();
  }

  async respond(input: ManagedConversationResponseRequest) {
    const plan = await this.options.resolvePlan(input);
    validateConversationResponseRequest(this.options, input, plan);
    const requestDigest = conversationResponseRequestDigest({ request: input, plan });
    let artifact = await this.options.responseArtifacts?.get(requestDigest);
    if (artifact === undefined || artifact === null) {
      artifact = await this.generateArtifact({ request: input, plan, requestDigest });
      await this.options.responseArtifacts?.put({
        requestDigest,
        artifact,
        createdAt: (this.options.now?.() ?? new Date()).toISOString(),
      });
    }
    try {
      return await publishConversationResponse({
        artifact,
        writingContract: plan.writingContract,
        artifactStore: this.options.artifactStore,
        semanticEvaluator: this.options.semanticEvaluator,
        ...(plan.maximumResponseCharacters === undefined
          ? {}
          : { maximumResponseCharacters: plan.maximumResponseCharacters }),
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
      });
    } catch (error) {
      if (
        error instanceof ManagedConversationResponseError &&
        error.code === "writing_publication_blocked"
      ) {
        await this.options.responseArtifacts?.remove(requestDigest);
      }
      throw error;
    }
  }

  private async generateArtifact(input: {
    request: ManagedConversationResponseRequest;
    plan: ManagedConversationResponsePlan;
    requestDigest: string;
  }) {
    const message = await readConversationMessage({
      content: input.request.event.content,
      artifactStore: this.options.artifactStore,
    });
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
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(this.options.createEventId === undefined
        ? {}
        : { createEventId: this.options.createEventId }),
    });
    const run = await coordinator.run({
      repositoryRoot: this.options.repositoryRoot,
      requestDigest: input.requestDigest,
      risk: "low",
      instructions: conversationResponseInstructions(
        input.request,
        message,
        input.plan.role.roleId,
        input.plan.maximumResponseCharacters,
      ),
      targetTurnId: input.plan.targetTurnId,
      context: {
        registry: input.plan.registry,
        role: input.plan.role,
        expectedPaths: [...(input.plan.expectedPaths ?? [])],
        documentRules: input.plan.documentRules,
        ...(input.plan.additionalCandidates === undefined
          ? {}
          : { additionalCandidates: input.plan.additionalCandidates }),
        publications: input.plan.publications,
        handoffs: input.plan.handoffs,
      },
      writingPolicy: input.plan.writingPolicy,
      resolvedSkills: input.plan.resolvedSkills,
    });
    validateConversationManagedRun({
      run,
      events: this.options.events,
      requestDigest: input.requestDigest,
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

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
  ManagedConversationResponseRequest,
  ManagedConversationResponderOptions,
  ManagedConversationResponderPort,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class ManagedConversationResponder implements ManagedConversationResponderPort {
  private readonly providerSessions;

  constructor(private readonly options: ManagedConversationResponderOptions) {
    this.providerSessions = options.providerSessions ??
      new MemoryConversationProviderSessionRegistry();
  }

  async respond(input: ManagedConversationResponseRequest) {
    const plan = await this.options.resolvePlan(input);
    validateConversationResponseRequest(this.options, input, plan);
    const message = await readConversationMessage({
      content: input.event.content,
      artifactStore: this.options.artifactStore,
    });
    const requestDigest = conversationResponseRequestDigest({ request: input, plan });
    const coordinator = new ManagedProviderRunCoordinator({
      adapter: plan.adapter,
      coordinates: {
        projectId: this.options.projectId,
        runId: plan.runId,
        sessionId: plan.sessionId,
        roleId: plan.role.roleId,
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
      requestDigest,
      risk: "low",
      instructions: conversationResponseInstructions(input, message),
      targetTurnId: plan.targetTurnId,
      context: {
        registry: plan.registry,
        role: plan.role,
        expectedPaths: [...(plan.expectedPaths ?? [])],
        documentRules: plan.documentRules,
        publications: plan.publications,
        handoffs: plan.handoffs,
      },
      writingPolicy: plan.writingPolicy,
      resolvedSkills: plan.resolvedSkills,
    });
    validateConversationManagedRun({
      run,
      events: this.options.events,
      requestDigest,
      roleId: plan.role.roleId,
      targetTurnId: plan.targetTurnId,
      publications: plan.publications,
    });
    let claimed = false;
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
    return publishConversationResponse({
      run,
      writingContract: plan.writingContract,
      artifactStore: this.options.artifactStore,
      semanticEvaluator: this.options.semanticEvaluator,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}

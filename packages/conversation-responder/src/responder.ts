import type { ConversationReplyCandidate } from "@lervo/interaction";

import { ManagedConversationArtifactRunner } from "./managed-artifact-runner.js";
import { readConversationMessage } from "./message-artifact.js";
import {
  conversationResponseInstructions,
  conversationResponseRequestDigest,
  validateConversationResponseRequest,
} from "./request.js";
import { publishConversationResponse } from "./response-publication.js";
import type {
  ManagedConversationResponsePlan,
  ManagedConversationResponseRequest,
  ManagedConversationResponderOptions,
  ManagedConversationResponderPort,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class ManagedConversationResponder implements ManagedConversationResponderPort {
  private readonly runner;
  private readonly inFlight = new Map<string, Promise<ConversationReplyCandidate>>();

  constructor(private readonly options: ManagedConversationResponderOptions) {
    this.runner = new ManagedConversationArtifactRunner(options);
  }

  async respond(input: ManagedConversationResponseRequest) {
    const plan = await this.options.resolvePlan(input);
    validateConversationResponseRequest(this.options, input, plan);
    const requestDigest = conversationResponseRequestDigest({
      request: input,
      plan,
      policyVersion: this.options.policyVersion,
    });
    const existing = this.inFlight.get(requestDigest);
    if (existing !== undefined) return existing;
    const response = this.respondOnce(input, plan, requestDigest);
    this.inFlight.set(requestDigest, response);
    try {
      return await response;
    } finally {
      if (this.inFlight.get(requestDigest) === response) this.inFlight.delete(requestDigest);
    }
  }

  private async respondOnce(
    input: ManagedConversationResponseRequest,
    plan: ManagedConversationResponsePlan,
    requestDigest: string,
  ): Promise<ConversationReplyCandidate> {
    let generated = await this.options.responseArtifacts?.get(requestDigest);
    if (generated === undefined || generated === null) {
      generated = await this.generateArtifact({ request: input, plan, requestDigest });
      await this.options.responseArtifacts?.put({
        requestDigest,
        result: generated,
        createdAt: (this.options.now?.() ?? new Date()).toISOString(),
      });
    }
    try {
      return await publishConversationResponse({
        artifact: generated.artifact,
        writingContract: plan.writingContract,
        artifactStore: this.options.artifactStore,
        ...(this.options.semanticEvaluator === undefined
          ? {}
          : { semanticEvaluator: this.options.semanticEvaluator }),
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
    return this.runner.run({
      plan: input.plan,
      requestDigest: input.requestDigest,
      instructions: conversationResponseInstructions(
        input.request,
        message,
        input.plan.executionIdentity,
        input.plan.role.roleId,
        input.plan.maximumResponseCharacters,
      ),
    });
  }
}

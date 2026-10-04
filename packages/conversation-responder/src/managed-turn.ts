import { ManagedConversationArtifactRunner } from "./managed-artifact-runner.js";
import {
  managedConversationTurnInstructions,
  managedConversationTurnRequestDigest,
  managedTurnDigest,
  parseManagedConversationTurn,
  type ManagedTurnBody,
} from "./managed-turn-contract.js";
import {
  readManagedConversationTurnArtifact,
  storeManagedConversationReply,
} from "./managed-turn-artifact.js";
import { readConversationMessage } from "./message-artifact.js";
import {
  generatedReplyProviderClaim,
  publishConversationResponse,
} from "./response-publication.js";
import { validateConversationResponsePlan } from "./request.js";
import type {
  ManagedConversationResponsePlan,
  ManagedConversationTurnRequest,
  ManagedConversationTurnResolution,
  ManagedConversationTurnResolverOptions,
  ManagedConversationTurnResolverPort,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class ManagedConversationTurnResolver implements ManagedConversationTurnResolverPort {
  private readonly runner: ManagedConversationArtifactRunner;
  private readonly inFlight = new Map<string, Promise<ManagedConversationTurnResolution>>();

  constructor(private readonly options: ManagedConversationTurnResolverOptions) {
    this.runner = new ManagedConversationArtifactRunner(options);
  }

  async resolve(input: ManagedConversationTurnRequest): Promise<ManagedConversationTurnResolution> {
    const plan = await this.options.resolvePlan(input);
    validateConversationResponsePlan(this.options, input, plan);
    const turnDigest = managedConversationTurnRequestDigest({
      request: input,
      plan,
      policyVersion: this.options.policyVersion,
    });
    const existing = this.inFlight.get(turnDigest);
    if (existing !== undefined) return existing;
    const resolution = this.resolveOnce(input, plan, turnDigest);
    this.inFlight.set(turnDigest, resolution);
    try {
      return await resolution;
    } finally {
      if (this.inFlight.get(turnDigest) === resolution) this.inFlight.delete(turnDigest);
    }
  }

  private async resolveOnce(
    input: ManagedConversationTurnRequest,
    plan: ManagedConversationResponsePlan,
    turnDigest: string,
  ): Promise<ManagedConversationTurnResolution> {
    const generated = await this.resolveArtifact(input, plan, turnDigest);
    let body: ManagedTurnBody;
    try {
      body = parseManagedConversationTurn(
        JSON.parse(await readManagedConversationTurnArtifact(this.options, generated.artifact)),
        input.surfaceEffects,
        plan.maximumResponseCharacters ?? 2_000,
      );
    } catch (error) {
      await this.options.responseArtifacts?.remove(turnDigest);
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "The managed conversation turn returned an invalid structured result.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const replyCandidate =
      body.reply === null
        ? null
        : await publishConversationResponse({
            artifact: await storeManagedConversationReply(this.options, body.reply),
            writingContract: plan.writingContract,
            artifactStore: this.options.artifactStore,
            ...(this.options.semanticEvaluator === undefined
              ? {}
              : { semanticEvaluator: this.options.semanticEvaluator }),
            ...(plan.maximumResponseCharacters === undefined
              ? {}
              : { maximumResponseCharacters: plan.maximumResponseCharacters }),
            ...(this.options.now === undefined ? {} : { now: this.options.now }),
            providerClaim: generatedReplyProviderClaim({
              provider: generated.modelIdentity.provider,
              ...(this.options.verifiedDeliberation === undefined
                ? {}
                : { verifiedDeliberation: this.options.verifiedDeliberation }),
            }),
          });
    if (replyCandidate !== null) replyCandidate.deliveryRelation = body.deliveryRelation;
    return {
      intent: body.intent,
      confidence: body.confidence,
      participation: body.participation,
      effect: body.effect,
      executionProfile: body.executionProfile,
      provider: {
        providerId: generated.modelIdentity.provider,
        requestedModel: generated.modelIdentity.requestedModel,
        model: generated.modelIdentity.answerModel,
        observedModelIds: [...generated.modelIdentity.observedModelIds],
        answerModelEvidence: generated.modelIdentity.answerModelEvidence,
        modelUnavailableReason: generated.modelIdentity.unavailableReason,
        adapterVersion: "4",
      },
      resultDigest: managedTurnDigest(JSON.stringify(body)),
      replyCandidate,
    };
  }

  private async resolveArtifact(
    input: ManagedConversationTurnRequest,
    plan: ManagedConversationResponsePlan,
    turnDigest: string,
  ) {
    const cached = await this.options.responseArtifacts?.get(turnDigest);
    if (cached !== undefined && cached !== null) return cached;
    const message = await readConversationMessage({
      content: input.event.content,
      artifactStore: this.options.artifactStore,
    });
    const artifact = await this.runner.run({
      plan,
      requestDigest: turnDigest,
      instructions: managedConversationTurnInstructions({ request: input, message, plan }),
    });
    await this.options.responseArtifacts?.put({
      requestDigest: turnDigest,
      result: artifact,
      createdAt: (this.options.now?.() ?? new Date()).toISOString(),
    });
    return artifact;
  }
}

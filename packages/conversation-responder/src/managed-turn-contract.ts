import { createHash } from "node:crypto";

import type {
  ManagedConversationResponsePlan,
  ManagedConversationSurfaceEffect,
  ManagedConversationTurnRequest,
  ManagedConversationTurnResolution,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export interface ManagedTurnBody {
  schemaVersion: 2;
  intent: ManagedConversationTurnResolution["intent"];
  confidence: ManagedConversationTurnResolution["confidence"];
  participation: ManagedConversationTurnResolution["participation"];
  effect: { kind: string; argument: string | null };
  deliveryRelation: "standalone" | "reply";
  reply: string | null;
}

export function managedTurnDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function effectIds(effects: readonly ManagedConversationSurfaceEffect[]): string[] {
  const ids = effects.map((effect) => effect.effectId);
  if (
    effects.some(
      (effect) =>
        !/^[a-z][a-z0-9_.-]{0,95}$/u.test(effect.effectId) ||
        effect.description.trim().length === 0 ||
        effect.description.length > 512 ||
        (effect.argumentDescription !== null &&
          (effect.argumentDescription.trim().length === 0 ||
            effect.argumentDescription.length > 256)) ||
        (effect.maximumArgumentCharacters !== undefined &&
          (!Number.isSafeInteger(effect.maximumArgumentCharacters) ||
            effect.maximumArgumentCharacters < 1 ||
            effect.maximumArgumentCharacters > 4_096)),
    ) ||
    new Set(ids).size !== ids.length ||
    ids.includes("none") ||
    ids.includes("repository_work")
  ) {
    throw new ManagedConversationResponseError(
      "invalid_response_request",
      "The surface-neutral conversation effect contract is invalid.",
    );
  }
  return ids;
}

export function managedConversationTurnOutputSchema(
  effects: readonly ManagedConversationSurfaceEffect[],
  maximumResponseCharacters = 2_000,
): Record<string, unknown> {
  const ids = effectIds(effects);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "integer", const: 2 },
      intent: { type: "string", enum: ["answer", "continue_work", "clarify"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      participation: { type: "string", enum: ["relevant", "not_relevant"] },
      effect: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["none", "repository_work", ...ids] },
          argument: {
            type: ["string", "null"],
            maxLength: 4_096,
            description:
              "A bounded argument for a listed surface effect only; use null for none or repository_work.",
          },
        },
        required: ["kind", "argument"],
      },
      deliveryRelation: { type: "string", enum: ["standalone", "reply"] },
      reply: { type: ["string", "null"], maxLength: maximumResponseCharacters },
    },
    required: [
      "schemaVersion",
      "intent",
      "confidence",
      "participation",
      "effect",
      "deliveryRelation",
      "reply",
    ],
  };
}

export function parseManagedConversationTurn(
  value: unknown,
  effects: readonly ManagedConversationSurfaceEffect[],
  maximumResponseCharacters: number,
): ManagedTurnBody {
  const ids = effectIds(effects);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The managed conversation turn result is not an object.");
  }
  const body = value as Record<string, unknown>;
  const effect = body.effect;
  if (
    Object.keys(body).length !== 7 ||
    body.schemaVersion !== 2 ||
    !["answer", "continue_work", "clarify"].includes(body.intent as string) ||
    !["high", "medium", "low"].includes(body.confidence as string) ||
    !["relevant", "not_relevant"].includes(body.participation as string) ||
    !["standalone", "reply"].includes(body.deliveryRelation as string) ||
    (body.reply !== null && typeof body.reply !== "string") ||
    typeof effect !== "object" ||
    effect === null ||
    Array.isArray(effect)
  ) {
    throw new TypeError("The managed conversation turn result violates its response contract.");
  }
  const effectBody = effect as Record<string, unknown>;
  if (
    Object.keys(effectBody).length !== 2 ||
    !["none", "repository_work", ...ids].includes(effectBody.kind as string) ||
    (effectBody.argument !== null && typeof effectBody.argument !== "string")
  ) {
    throw new TypeError("The managed conversation effect violates its response contract.");
  }
  const intent = body.intent as ManagedTurnBody["intent"];
  const participation = body.participation as ManagedTurnBody["participation"];
  const kind = effectBody.kind as string;
  const argument = effectBody.argument as string | null;
  const surfaceEffect = effects.find((candidate) => candidate.effectId === kind);
  const reply = body.reply as string | null;
  const deliveryRelation = body.deliveryRelation as ManagedTurnBody["deliveryRelation"];
  if (
    (intent !== "continue_work" && kind !== "none") ||
    (intent === "continue_work" && kind === "none") ||
    (kind === "none" && argument !== null) ||
    (surfaceEffect?.argumentDescription === null && argument !== null) ||
    (surfaceEffect?.argumentDescription !== null &&
      surfaceEffect !== undefined &&
      (argument === null || argument.trim().length === 0)) ||
    (argument !== null &&
      [...argument].length > (surfaceEffect?.maximumArgumentCharacters ?? 4_096)) ||
    (participation === "not_relevant" && (kind !== "none" || reply !== null)) ||
    (reply === null && deliveryRelation !== "standalone") ||
    (participation === "relevant" &&
      ["answer", "clarify"].includes(intent) &&
      (reply === null || reply.trim().length === 0)) ||
    (intent === "continue_work" && reply !== null) ||
    (reply !== null && [...reply].length > maximumResponseCharacters)
  ) {
    throw new TypeError(
      "The managed conversation intent, effect, participation, or reply conflicts.",
    );
  }
  return {
    schemaVersion: 2,
    intent,
    confidence: body.confidence as ManagedTurnBody["confidence"],
    participation,
    effect: { kind, argument: kind === "repository_work" ? null : argument },
    deliveryRelation,
    reply,
  };
}

export function managedConversationTurnRequestDigest(input: {
  request: ManagedConversationTurnRequest;
  plan: ManagedConversationResponsePlan;
  policyVersion: string;
}): string {
  return managedTurnDigest(
    JSON.stringify({
      contract: "lervo.managed-conversation-turn.v1",
      eventId: input.request.event.eventId,
      policyId: input.request.policy.policyId,
      policyVersion: input.policyVersion,
      messageHash: input.request.event.content.contentHash,
      actorKind: input.request.event.actor.kind,
      mentioned: input.request.mentioned,
      respondingAgent: input.request.respondingAgent,
      priorTurns: input.request.context?.priorTurns ?? [],
      surfaceEffects: input.request.surfaceEffects,
      roleId: input.plan.role.roleId,
      executionIdentity: input.plan.executionIdentity,
      maximumResponseCharacters: input.plan.maximumResponseCharacters ?? 2_000,
    }),
  );
}

export function managedConversationTurnInstructions(input: {
  request: ManagedConversationTurnRequest;
  message: string;
  plan: ManagedConversationResponsePlan;
}): string {
  return JSON.stringify({
    task: "managed_conversation_turn",
    instruction: [
      "Resolve intent, participation, requested effect, and the natural-language reply in this single managed turn.",
      "Use answer only when a read-only question or discussion can be answered from injected evidence and prior turns without live repository, terminal, test, build, network, or external-system observation. Use continue_work for live inspection or verification as well as repository, deployment, or surface mutations; use clarify only when the target or authority is materially ambiguous.",
      "A short request to proceed may use injected current-workstream context and priorTurns to resolve its target.",
      "Set participation relevant when directly addressed, mentioned, replied to, useful within the role, or serving the mapped human in its dedicated channel. Otherwise set not_relevant.",
      "Mentions are optional attention signals, never mandatory command syntax.",
      "For live repository, terminal, test, build, network, or external-system observation and for repository changes, use repository_work with argument null. Read-only native work may complete with zero changed paths. Use a bounded argument only for a listed surface action. Effects never grant authority.",
      "When supervision_goal_request is listed, use it only for a durable multi-step outcome that the installed owner should accept and govern across delegation, verification, or multiple turns. Use repository_work for one bounded task or inspection in the current conversation.",
      "For answer or clarify, write a direct conversational reply grounded only in injected evidence and prior turns. Do not expose internal run, workstream, revision, queue, or artifact IDs unless explicitly asked for diagnostics.",
      "Use deliveryRelation reply only when a native reply materially disambiguates which concurrent message is being answered or preserves an explicit reply relationship. Use standalone for ordinary sequential conversation; do not turn every response into a native reply.",
      "For continue_work, reply must be null because the execution path publishes progress and a verified result separately.",
      "If participation is not_relevant, use effect none and reply null.",
      "When asked about identity, distinguish durable agent and role from the turn provider. executionIdentity.requestedModel is configuration only; never present it as the provider-observed answer model.",
      "Return only the schema-valid object.",
    ],
    participationRoleId: input.request.policy.roleId,
    executionIdentity: input.plan.executionIdentity,
    respondingAgent: input.request.respondingAgent,
    actorKind: input.request.event.actor.kind,
    mentioned: input.request.mentioned,
    surfaceEffects: input.request.surfaceEffects,
    priorTurns: input.request.context?.priorTurns ?? [],
    untrustedMessage: input.message,
  });
}

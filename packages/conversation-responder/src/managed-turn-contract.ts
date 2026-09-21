import { createHash } from "node:crypto";

import type {
  ManagedConversationResponsePlan,
  ManagedConversationSurfaceEffect,
  ManagedConversationTurnRequest,
  ManagedConversationTurnResolution,
} from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export interface ManagedTurnBody {
  schemaVersion: 3;
  intent: ManagedConversationTurnResolution["intent"];
  confidence: ManagedConversationTurnResolution["confidence"];
  participation: ManagedConversationTurnResolution["participation"];
  effect: { kind: string; argument: string | null };
  executionProfile: "routine" | "reasoning" | "review" | null;
  deliveryRelation: "standalone" | "reply";
  reply: string | null;
}

export function managedTurnDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function effectIds(effects: readonly ManagedConversationSurfaceEffect[]): string[] {
  const ids = effects.map((effect) => effect.effectId);
  if (
    effects.some((effect) => {
      const choices = effect.argumentChoices ?? [];
      return (
        !/^[a-z][a-z0-9_.-]{0,95}$/u.test(effect.effectId) ||
        effect.description.trim().length === 0 ||
        effect.description.length > 512 ||
        (effect.argumentDescription !== null &&
          (effect.argumentDescription.trim().length === 0 ||
            effect.argumentDescription.length > 256)) ||
        (effect.argumentDescription === null && choices.length > 0) ||
        choices.length > 64 ||
        choices.some(
          (choice) =>
            choice.value.trim().length === 0 ||
            choice.value.length > 128 ||
            choice.label.trim().length === 0 ||
            choice.label.length > 256,
        ) ||
        new Set(choices.map((choice) => choice.value)).size !== choices.length ||
        (effect.maximumArgumentCharacters !== undefined &&
          (!Number.isSafeInteger(effect.maximumArgumentCharacters) ||
            effect.maximumArgumentCharacters < 1 ||
            effect.maximumArgumentCharacters > 4_096))
      );
    }) ||
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
      schemaVersion: { type: "integer", const: 3 },
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
      executionProfile: {
        type: ["string", "null"],
        enum: ["routine", "reasoning", "review", null],
        description:
          "Required for repository_work: routine for bounded mechanical work, reasoning for design or consequential judgment, review for independent verification; otherwise null.",
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
      "executionProfile",
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
    Object.keys(body).length !== 8 ||
    body.schemaVersion !== 3 ||
    !["answer", "continue_work", "clarify"].includes(body.intent as string) ||
    !["high", "medium", "low"].includes(body.confidence as string) ||
    !["relevant", "not_relevant"].includes(body.participation as string) ||
    !["standalone", "reply"].includes(body.deliveryRelation as string) ||
    !["routine", "reasoning", "review", null].includes(body.executionProfile as string | null) ||
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
  const executionProfile = body.executionProfile as ManagedTurnBody["executionProfile"];
  const deliveryRelation = body.deliveryRelation as ManagedTurnBody["deliveryRelation"];
  const acknowledgesSupervisionGoal = kind === "supervision_goal_request";
  // Most schema-listed actions publish their own verified result. Supervision intake instead
  // retains a request-grounded acknowledgment and releases it only after admission succeeds.
  const normalizedIntent = surfaceEffect === undefined ? intent : "continue_work";
  const normalizedReply = surfaceEffect === undefined || acknowledgesSupervisionGoal ? reply : null;
  const normalizedDeliveryRelation = surfaceEffect === undefined ? deliveryRelation : "standalone";
  if (
    (normalizedIntent !== "continue_work" && kind !== "none") ||
    (normalizedIntent === "continue_work" && kind === "none") ||
    (kind === "none" && argument !== null) ||
    (surfaceEffect?.argumentDescription === null && argument !== null) ||
    (surfaceEffect?.argumentDescription !== null &&
      surfaceEffect !== undefined &&
      (argument === null || argument.trim().length === 0)) ||
    (argument !== null &&
      [...argument].length > (surfaceEffect?.maximumArgumentCharacters ?? 4_096)) ||
    (participation === "not_relevant" && (kind !== "none" || normalizedReply !== null)) ||
    (normalizedReply === null && normalizedDeliveryRelation !== "standalone") ||
    (participation === "relevant" &&
      ["answer", "clarify"].includes(normalizedIntent) &&
      (normalizedReply === null || normalizedReply.trim().length === 0)) ||
    (acknowledgesSupervisionGoal &&
      (normalizedReply === null || normalizedReply.trim().length === 0)) ||
    (normalizedIntent === "continue_work" &&
      normalizedReply !== null &&
      !acknowledgesSupervisionGoal) ||
    (kind === "repository_work" && executionProfile === null) ||
    (kind !== "repository_work" && executionProfile !== null) ||
    (normalizedReply !== null && [...normalizedReply].length > maximumResponseCharacters)
  ) {
    throw new TypeError(
      "The managed conversation intent, effect, participation, or reply conflicts.",
    );
  }
  return {
    schemaVersion: 3,
    intent: normalizedIntent,
    confidence: body.confidence as ManagedTurnBody["confidence"],
    participation,
    effect: { kind, argument: kind === "repository_work" ? null : argument },
    executionProfile,
    deliveryRelation: normalizedDeliveryRelation,
    reply: normalizedReply,
  };
}

export function managedConversationTurnRequestDigest(input: {
  request: ManagedConversationTurnRequest;
  plan: ManagedConversationResponsePlan;
  policyVersion: string;
}): string {
  return managedTurnDigest(
    JSON.stringify({
      contract: "lervo.managed-conversation-turn.v2",
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
  const delegatedResultRequirements =
    input.request.event.coordination?.kind === "task.result"
      ? [
          "This is an authenticated result from a task you delegated. Reconcile it against the complete original human outcome in priorTurns. If the requested outcome remains incomplete, select the authorized effect that advances the concrete next action; do not stop at repeating the status report. If it is complete or no further action was requested, give the person one concise synthesis.",
        ]
      : [];
  return JSON.stringify({
    task: "managed_conversation_turn",
    instruction: [
      "Resolve intent, participation, requested effect, and the natural-language reply in this single managed turn.",
      "This turn intentionally has read-only classifier and answer capabilities. That boundary does not limit the separate repository-work runner: never answer that live work cannot be performed because this turn cannot write, execute, test, build, use the network, or change an external system. Select continue_work with the appropriate effect instead.",
      "Use answer only when a read-only question or discussion can be answered from injected evidence and prior turns without live repository, terminal, test, build, network, or external-system observation. Use continue_work for live inspection or verification as well as repository, deployment, or surface mutations; use clarify only when the target or authority is materially ambiguous.",
      "A short request to proceed may use injected current-workstream context and priorTurns to resolve its target.",
      "Set participation relevant when directly addressed, mentioned, replied to, useful within the role, or serving the mapped human in its dedicated channel. Otherwise set not_relevant.",
      "Mentions are optional attention signals, never mandatory command syntax.",
      "For live repository, terminal, test, build, network, or external-system observation and for repository changes, use repository_work with argument null. Read-only native work may complete with zero changed paths. Use a bounded argument only for a listed surface action. Effects never grant authority.",
      "Prefer a listed surface action when the requested outcome matches its description; do not replace that action with repository_work merely because its topic concerns a repository, deployment, verification, or another external system.",
      "Every selected listed surface action uses intent continue_work, executionProfile null, and deliveryRelation standalone. Use reply null unless the selected effect is supervision_goal_request.",
      "When deliberation_start is listed, use it when the requester asks this participant to convene multiple independently bound agents, gather their separate role- and context-grounded judgments, debate or compare them, and converge on one synthesis. Starting that governed discussion is the requested surface action, not repository_work; put the complete discussion topic in its argument.",
      "Choose among direct repository work, a listed surface action, delegation, clarification, or a direct answer from this durable agent's role, context, available capabilities, and responsibility for the requested outcome. Do not force a particular route merely because a canned scenario resembles the message.",
      "When workforce_task_delegate is listed, use it when an exact peer's durable role, context, or knowledge makes a bounded subtask useful. Write only that natural subtask; do not assign a synthetic stakeholder persona or paste a generic 'delegated agent' preamble. Delegation does not transfer ownership of the person's complete outcome: retain it in this coordinator's context and reconcile the peer's result before completing.",
      ...delegatedResultRequirements,
      "When a surface effect declares argumentChoices, select only an exact listed value. Labels explain human-facing identity but are not valid substitutes for values.",
      "When supervision_goal_request is listed, use it only for a durable multi-step outcome that the installed owner should accept and govern across delegation, verification, or multiple turns. Use repository_work for one bounded task or inspection in the current conversation. For supervision_goal_request, write one brief natural-language acknowledgment grounded in the exact request and current context. State the outcome or priority you understood. Do not claim that admission succeeded, work started, work completed, or results were verified; the action path publishes this acknowledgment only after successful admission.",
      "For repository_work, select exactly one executionProfile by meaning: routine for bounded mechanical edits, ordinary implementation, or standard checks; reasoning for architecture, design, planning, ambiguous diagnosis, or consequential judgment; review for verification, audit, critique, acceptance, or independent assessment. Quality and risk take precedence over cost. Use null for every other effect.",
      "Classify the primary requested deliverable, not every incidental step in the work. Ordinary implementation remains routine even when it needs brief planning, code reading, or local debugging. Choose reasoning when an architecture, product trade-off, or genuinely ambiguous diagnosis is itself the requested deliverable or materially determines the solution; do not upgrade a task merely because it is long or consequential in size. Choose review when independent assessment is the requested deliverable, not for the standard checks that accompany implementation.",
      "For answer or clarify, write a direct conversational reply grounded only in injected evidence and prior turns. Do not expose internal run, workstream, revision, queue, or artifact IDs unless explicitly asked for diagnostics.",
      "Use deliveryRelation reply only when a native reply materially disambiguates which concurrent message is being answered or preserves an explicit reply relationship. Use standalone for ordinary sequential conversation; do not turn every response into a native reply.",
      "For continue_work, reply must be null because the execution path publishes progress and a verified result separately, except for the bounded supervision_goal_request acknowledgment described above.",
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

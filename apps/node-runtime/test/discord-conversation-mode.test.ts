import { createHash } from "node:crypto";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  ConversationIntent,
  ConversationIntentResolver,
} from "../src/conversation-intent-resolver.js";
import {
  type DiscordGoalResponder,
  NaturalLanguageDiscordConversationResponder,
} from "../src/discord-conversation-mode.js";

const applicationId = "999999999999999999";

describe("natural-language Discord conversation mode", () => {
  it("accepts ordinary and mentioned messages while routing by semantic intent", async () => {
    const participationPolicy = createConversationParticipationPolicy({
      projectId: "prj_test0001",
      roleId: "developer",
      conversationIds: ["cnv_test0001"],
      mode: "relevant",
      respondTo: ["human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 8,
      maxAutomationDepth: 2,
      createdAt: "2026-09-07T07:00:00.000Z",
    });
    let message = "What remains in the current workstream?";
    let intent: ConversationIntent = "answer";
    let effect = { kind: "none" as const } as
      | { kind: "none" }
      | { kind: "repository_work" }
      | { kind: "supervision_goal_request" }
      | { kind: "discord_current_member_nickname_set"; nickname: string };
    const readOnly = {
      respond: vi.fn<ConversationResponder["respond"]>(async () => candidate("Read-only answer.")),
    };
    const continuation = {
      respond: vi.fn<ConversationResponder["respond"]>(async () => candidate("Work was queued.")),
    };
    const goal = {
      respond: vi.fn<ConversationResponder["respond"]>(async () => candidate("Goal accepted.")),
    };
    const platformAction = {
      availableEffects: [
        "none" as const,
        "repository_work" as const,
        "discord_current_member_nickname_set" as const,
      ],
      managedResultEffects: ["discord_current_member_nickname_set" as const],
      respond: vi.fn(async () => candidate("Display name changed.")),
    };
    const stored = new Map<string, Uint8Array>();
    const put: ArtifactStore["put"] = async (content) => {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const contentHash = hash(bytes);
      const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
      stored.set(uri, bytes);
      return { uri, contentHash, byteCount: bytes.byteLength, created: true };
    };
    const artifactStore: ArtifactStore = {
      put,
      putStream: async (chunks) => {
        const collected: Uint8Array[] = [];
        for await (const chunk of chunks) {
          collected.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
        }
        return put(Buffer.concat(collected));
      },
      get: async (uri) => stored.get(uri)!,
      has: async (uri) => stored.has(uri),
    };
    const candidate = async (content: string) => {
      const bytes = new TextEncoder().encode(content);
      await artifactStore.put(bytes);
      return {
        content: { contentHash: hash(bytes), byteCount: bytes.byteLength },
      } as Awaited<ReturnType<ConversationResponder["respond"]>>;
    };
    const resolveIntent = vi.fn<ConversationIntentResolver["resolve"]>(async () => ({
      intent,
      confidence: "high" as const,
      participation: "relevant" as const,
      effect,
      provider: { providerId: "codex", model: null, adapterVersion: "2" as const },
      resultDigest: `sha256:${"e".repeat(64)}`,
    }));
    const resolver: ConversationIntentResolver = { resolve: resolveIntent };
    const resolutions = new Map<
      string,
      Awaited<ReturnType<ConversationIntentResolver["resolve"]>>
    >();
    const resolutionStore = {
      read: async (event: { eventId: string }) => resolutions.get(event.eventId) ?? null,
      record: async (input: {
        event: { eventId: string };
        resolution: Awaited<ReturnType<ConversationIntentResolver["resolve"]>>;
      }) => {
        resolutions.set(input.event.eventId, input.resolution);
      },
    };
    const responder = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: {
        recent: async () => [
          {
            role: "user",
            text: "Please inspect the active work.",
            speaker: {
              kind: "human",
              participantId: "ptc_test0001",
              agentId: null,
              roleId: null,
            },
          },
          {
            role: "assistant",
            text: "The active work is ready to continue.",
            speaker: {
              kind: "agent",
              participantId: "ptc_lervoagent",
              agentId: `agt_${"a".repeat(24)}`,
              roleId: "developer",
            },
          },
        ],
      },
      resolutionStore,
      intentResolver: resolver,
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      goal: goal as ConversationResponder,
      availableEffects: [
        "none",
        "repository_work",
        "supervision_goal_request",
        "discord_current_member_nickname_set",
      ],
      platformAction,
    });
    const input = async (eventId: string) => {
      const bytes = new TextEncoder().encode(message);
      const storedMessage = await artifactStore.put(bytes);
      return {
        event: createConversationInboundEvent({
          sourceEventKeyHash: hashConversationSourceEventKey(eventId),
          target: {
            integrationId: "itg_test0001",
            projectId: "prj_test0001",
            conversationId: "cnv_test0001",
            threadId: null,
          },
          kind: "message.created",
          actor: { kind: "human", participantId: "ptc_test0001", roleId: null },
          mentions: { participantIds: [], roleIds: [] },
          content: {
            artifactId: `art_${eventId}`,
            contentHash: storedMessage.contentHash,
            byteCount: storedMessage.byteCount,
            mediaType: "text/plain; charset=utf-8",
          },
          replyToEventId: null,
          signalCode: null,
          automationDepth: 0,
          occurredAt: "2026-09-07T08:00:00.000Z",
        }),
      } as Parameters<ConversationResponder["respond"]>[0];
    };

    const first = await input("cevt_test0001");
    await responder.respond(first);
    expect(readOnly.respond).toHaveBeenCalledOnce();
    expect(resolveIntent.mock.calls[0]![0]).toMatchObject({ mentioned: false, message });
    await expect(responder.evaluate(first)).resolves.toBe("relevant");
    expect(resolveIntent).toHaveBeenCalledTimes(1);

    intent = "continue_work";
    effect = { kind: "repository_work" };
    message = `<@${applicationId}> Finish it.`;
    const second = await input("cevt_test0002");
    second.event.mentions.participantIds.push("ptc_lervoagent");
    await responder.respond(second);
    expect(continuation.respond).toHaveBeenCalledOnce();
    expect(resolveIntent.mock.calls[1]![0]).toMatchObject({
      mentioned: true,
      message: "Finish it.",
    });
    expect(resolveIntent.mock.calls[1]![0].priorTurns).toHaveLength(2);
    expect(continuation.respond.mock.calls[0]![0].context?.priorTurns).toHaveLength(2);

    intent = "answer";
    effect = { kind: "none" };
    message = "Tarin, what is happening?";
    const addressedToAnotherAgent = await input("cevt_test_other_agent_mention");
    addressedToAnotherAgent.event.mentions.participantIds.push("ptc_tarinagent");
    await responder.respond(addressedToAnotherAgent);
    expect(resolveIntent.mock.calls[2]![0]).toMatchObject({ mentioned: false });

    effect = { kind: "supervision_goal_request" };
    intent = "continue_work";
    message = "Own this multi-stage release goal through verification and deployment.";
    const supervised = await input("cevt_test0009");
    await responder.respond(supervised);
    expect(goal.respond).toHaveBeenCalledOnce();
    await expect(responder.mode(supervised.event)).resolves.toBe("goal");

    effect = { kind: "discord_current_member_nickname_set", nickname: "Lervo" };
    message = "Change your server nickname to Lervo.";
    const third = await input("cevt_test0003");
    await responder.respond(third);
    expect(platformAction.respond).toHaveBeenCalledWith(
      expect.objectContaining({ context: { priorTurns: expect.any(Array) } }),
      { kind: "discord_current_member_nickname_set", nickname: "Lervo" },
      { effectRequesterAuthorized: true },
    );
    await expect(responder.usesManagedActionResultPublicationContract(third.event)).resolves.toBe(
      true,
    );

    const unacceptedDiscussion = await input("cevt_test_discussion_invalid");
    unacceptedDiscussion.event.coordination = {
      kind: "discussion.contribution",
      discussionId: "dsc_unknown",
    };
    await expect(responder.evaluate(unacceptedDiscussion)).resolves.toBe("not_relevant");
    expect(resolveIntent).toHaveBeenCalledTimes(5);

    const restarted = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore,
      intentResolver: resolver,
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: {
        availableEffects: ["none", "repository_work"],
        respond: vi.fn(),
      },
    });
    await restarted.respond(first);
    expect(resolveIntent).toHaveBeenCalledTimes(5);
    expect(readOnly.respond).toHaveBeenCalledTimes(3);

    const managedReply = await candidate("One managed turn resolved and answered this message.");
    const managedResolve = vi.fn(async () => ({
      intent: "answer" as const,
      confidence: "high" as const,
      participation: "relevant" as const,
      effect: { kind: "none" as const, argument: null },
      executionProfile: null,
      provider: {
        providerId: "codex",
        requestedModel: "gpt-requested",
        model: "gpt-observed",
        observedModelIds: ["gpt-observed"],
        answerModelEvidence: "thread_start" as const,
        modelUnavailableReason: null,
        adapterVersion: "4" as const,
      },
      resultDigest: `sha256:${"f".repeat(64)}`,
      replyCandidate: managedReply,
    }));
    const managedMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: {
        read: async () => null,
        record: async () => undefined,
      },
      managedTurnResolver: { resolve: managedResolve },
      surfaceEffects: [],
      participationPolicy,
      readOnly: {
        respond: vi.fn(async () => candidate("Legacy read path must not run.")),
      },
      continuation: continuation as ConversationResponder,
      platformAction,
    });
    message = "Which model is answering me?";
    const fourth = await input("cevt_test0004");
    await expect(managedMode.evaluate(fourth)).resolves.toBe("relevant");
    await expect(managedMode.respond(fourth)).resolves.toEqual(managedReply);
    expect(managedResolve).toHaveBeenCalledTimes(1);

    const goalAcknowledgment = await candidate(
      "I understand that verification and deployment are the required outcome.",
    );
    const managedGoal = {
      respond: vi.fn<DiscordGoalResponder["respond"]>(
        async (_request, admittedReplyCandidate) =>
          admittedReplyCandidate ?? candidate("Missing acknowledgment."),
      ),
    };
    const managedGoalMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "product-owner",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: {
        resolve: async () => ({
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "supervision_goal_request", argument: null },
          executionProfile: null,
          provider: {
            providerId: "codex",
            requestedModel: "gpt-requested",
            model: "gpt-observed",
            observedModelIds: ["gpt-observed"],
            answerModelEvidence: "thread_start",
            modelUnavailableReason: null,
            adapterVersion: "4",
          },
          resultDigest: `sha256:${"b".repeat(64)}`,
          replyCandidate: goalAcknowledgment,
        }),
      },
      surfaceEffects: [
        {
          effectId: "supervision_goal_request",
          description: "Ask the installed owner to govern a durable multi-step outcome.",
          argumentDescription: null,
        },
      ],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      goal: managedGoal,
      platformAction,
    });
    message = "Own verification and deployment through completion.";
    const managedGoalInput = await input("cevt_test_managed_goal");
    await expect(managedGoalMode.respond(managedGoalInput)).resolves.toBe(goalAcknowledgment);
    expect(managedGoal.respond).toHaveBeenCalledWith(expect.any(Object), goalAcknowledgment);

    const agentWorkResolver = {
      resolve: vi.fn(async () => ({
        intent: "continue_work" as const,
        confidence: "high" as const,
        participation: "relevant" as const,
        effect: { kind: "repository_work" as const, argument: null },
        executionProfile: "reasoning" as const,
        provider: {
          providerId: "codex",
          requestedModel: "gpt-requested",
          model: "gpt-observed",
          observedModelIds: ["gpt-observed"],
          answerModelEvidence: "thread_start" as const,
          modelUnavailableReason: null,
          adapterVersion: "4" as const,
        },
        resultDigest: `sha256:${"a".repeat(64)}`,
        replyCandidate: null,
      })),
    };
    const agentWork = await input("cevt_test0005");
    agentWork.event.actor = {
      kind: "agent",
      participantId: "ptc_ceoagent01",
      roleId: "ceo",
    };
    const restrictedAgentMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: agentWorkResolver,
      surfaceEffects: [],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction,
    });
    await expect(restrictedAgentMode.mode(agentWork.event)).resolves.toBe("clarify");

    const authorizedAgentMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      authorizedAgentEffectRequesters: [
        {
          participantId: "ptc_ceoagent01",
          roleId: "ceo",
          conversationId: "cnv_test0001",
          effectKinds: ["repository_work"],
        },
      ],
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: agentWorkResolver,
      surfaceEffects: [],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction,
    });
    await expect(authorizedAgentMode.mode(agentWork.event)).resolves.toBe("work");
    await authorizedAgentMode.respond(agentWork);
    expect(continuation.respond).toHaveBeenCalledTimes(2);
    expect(continuation.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ executionProfile: "reasoning" }),
      }),
    );

    const threadAction = {
      availableEffects: [
        "none" as const,
        "repository_work" as const,
        "discord_public_thread_create" as const,
      ],
      respond: vi.fn(async () => candidate("Thread created.")),
    };
    const authorizedThreadMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "developer",
      },
      authorizedAgentEffectRequesters: [
        {
          participantId: "ptc_ceoagent01",
          roleId: "ceo",
          conversationId: "cnv_test0001",
          effectKinds: ["discord_public_thread_create"],
        },
      ],
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: {
        resolve: async () => ({
          ...(await agentWorkResolver.resolve()),
          effect: { kind: "discord_public_thread_create", argument: "Release review" },
          executionProfile: null,
        }),
      },
      surfaceEffects: [
        {
          effectId: "discord_public_thread_create",
          description: "Create a public thread.",
          argumentDescription: "Thread name.",
          maximumArgumentCharacters: 100,
        },
      ],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: threadAction,
    });
    await authorizedThreadMode.respond(agentWork);
    expect(threadAction.respond).toHaveBeenCalledWith(
      expect.any(Object),
      { kind: "discord_public_thread_create", name: "Release review" },
      { effectRequesterAuthorized: true },
    );

    const delegationAction = {
      availableEffects: ["workforce_task_delegate" as const],
      respond: vi.fn(async () => candidate("Task delegated.")),
    };
    const naturalDelegation = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "product-owner",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: {
        resolve: async () => ({
          ...(await agentWorkResolver.resolve()),
          effect: {
            kind: "workforce_task_delegate",
            argument: JSON.stringify({
              participantId: "ptc_peer_researcher0001",
              task: "Review the conversation routing evidence.",
            }),
          },
          executionProfile: null,
        }),
      },
      surfaceEffects: [
        {
          effectId: "workforce_task_delegate",
          description: "Delegate a task to a hired agent.",
          argumentDescription: "JSON containing participantId and task.",
          maximumArgumentCharacters: 1_024,
        },
      ],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: delegationAction,
    });
    const humanDelegation = await input("cevt_test0011");
    await naturalDelegation.respond(humanDelegation);
    expect(delegationAction.respond).toHaveBeenCalledWith(
      expect.any(Object),
      {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({
          participantId: "ptc_peer_researcher0001",
          task: "Review the conversation routing evidence.",
        }),
      },
      { effectRequesterAuthorized: true },
    );

    const deliberationAction = {
      availableEffects: ["deliberation_start" as const],
      respond: vi.fn(async () => candidate("Deliberation started.")),
    };
    const naturalDeliberation = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "product-owner",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: {
        resolve: async () => ({
          ...(await agentWorkResolver.resolve()),
          effect: {
            kind: "deliberation_start",
            argument: "Review the repository knowledge conflict strategy.",
          },
        }),
      },
      surfaceEffects: [
        {
          effectId: "deliberation_start",
          description: "Start a governed deliberation.",
          argumentDescription: "Topic.",
          maximumArgumentCharacters: 4_096,
        },
      ],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: deliberationAction,
    });
    const humanDeliberation = await input("cevt_test0010");
    await naturalDeliberation.respond(humanDeliberation);
    expect(deliberationAction.respond).toHaveBeenCalledWith(
      expect.any(Object),
      {
        kind: "deliberation_start",
        specification: "Review the repository knowledge conflict strategy.",
      },
      { effectRequesterAuthorized: true },
    );

    const resolveWithoutDiscussion = vi.fn(agentWorkResolver.resolve);
    const withoutDiscussion = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "product-owner",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      managedTurnResolver: { resolve: resolveWithoutDiscussion },
      surfaceEffects: [
        {
          effectId: "deliberation_start",
          description: "Start a governed discussion.",
          argumentDescription: "Topic.",
          maximumArgumentCharacters: 4_096,
        },
        {
          effectId: "workforce_task_delegate",
          description: "Delegate to one peer.",
          argumentDescription: "Task.",
          maximumArgumentCharacters: 1_024,
        },
      ],
      discussionEligibleConversationIds: [],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: deliberationAction,
    });
    await withoutDiscussion.mode((await input("cevt_test0012")).event);
    expect(resolveWithoutDiscussion).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceEffects: [expect.objectContaining({ effectId: "workforce_task_delegate" })],
      }),
    );

    const legacyResolver = vi.fn(resolveIntent);
    const legacyWithoutDiscussion = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: `agt_${"a".repeat(24)}`,
        roleId: "product-owner",
      },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      intentResolver: { resolve: legacyResolver },
      availableEffects: ["deliberation_start", "workforce_task_delegate"],
      discussionEligibleConversationIds: [],
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: deliberationAction,
    });
    await legacyWithoutDiscussion.mode((await input("cevt_test0013")).event);
    expect(legacyResolver).toHaveBeenCalledWith(
      expect.objectContaining({ availableEffects: ["workforce_task_delegate"] }),
    );
  });
});

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

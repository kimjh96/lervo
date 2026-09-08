import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { defaultEnglishWritingContract } from "@lervo/core";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { handleConversationEvent } from "@lervo/interaction";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import type { DocumentRegistry, RoleProfile, SharedContextPublication } from "@lervo/schemas";
import type { WritingArtifactCoordinate } from "@lervo/writing";
import { afterEach, describe, expect, it } from "vitest";

import { ManagedConversationResponder, VerifiedConversationPublication } from "../src/index.js";
import { ConversationClaudeClient, ConversationCodexClient } from "./provider-clients.js";

const projectId = "prj_conversation_bridge";
const policyVersion = hash("conversation-policy-v1");
const writingPath = "docs/writing.json";
const roots: string[] = [];

function hash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(8, "0")}`;
}

function clock(): () => Date {
  let value = Date.parse("2026-08-20T01:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

function record(path: string) {
  return {
    path,
    kind: "canonical" as const,
    responsibleParty: { kind: "team" as const, id: "team_lervo" },
    connectedPaths: [],
    verifiedRevision: "fixture-v1",
    verifiedAt: "2026-08-20T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" as const },
  };
}

function role(roleId: "reviewer" | "planner"): RoleProfile {
  return {
    schemaVersion: 1,
    roleId,
    name: roleId,
    description: `Responds to the conversation in the ${roleId} role.`,
    requestTypes: ["conversation.response"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy", "role.context"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "conversation_reply",
      schemaRef: "lervo-schema://outputs/conversation-reply/v1",
      pathTemplate: ".lervo/generated/conversation/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      },
    },
    verification: { suiteIds: ["conversation.reply"], failureDisposition: "fail_run" },
    handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
  };
}

function publication(input: {
  roleId: "reviewer" | "planner";
  documentId: string;
  contentHash: string;
}): SharedContextPublication {
  return {
    schemaVersion: 1,
    sharedContextId: `scx_${input.roleId}_context`,
    projectId,
    kind: "instruction",
    documentId: input.documentId,
    contentHash: input.contentHash,
    sourceRevision: "fixture-v1",
    producer: { kind: "system" },
    audience: { mode: "roles", roleIds: [input.roleId] },
    sensitivity: "restricted",
    evidenceEventIds: [],
    publishedAt: "2026-08-20T00:00:00Z",
    expiresAt: null,
    supersedesSharedContextId: null,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed conversation responder", () => {
  it("runs Codex and Claude in independent read-only sessions with role-specific shared context", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-response-"));
    roots.push(root);
    await Promise.all([
      mkdir(resolve(root, ".lervo/state/cas"), { recursive: true }),
      mkdir(resolve(root, "docs"), { recursive: true }),
    ]);
    const writingContent = `${JSON.stringify(defaultEnglishWritingContract, null, 2)}\n`;
    const reviewerContent = "The reviewer role checks risks and evidence first.\n";
    const plannerContent = "The planner role explains next actions and order first.\n";
    await Promise.all([
      writeFile(resolve(root, "AGENTS.md"), "Write responses in natural English sentences.\n"),
      writeFile(resolve(root, writingPath), writingContent),
      writeFile(resolve(root, "docs/reviewer.md"), reviewerContent),
      writeFile(resolve(root, "docs/planner.md"), plannerContent),
    ]);
    const artifacts = await FileSystemCas.open(resolve(root, ".lervo/state/cas"));
    const events = await SQLiteEventStore.open({
      path: resolve(root, ".lervo/state/events.sqlite"),
      projectId,
      writableEventSchemaVersion: 2,
    });
    const rawMessage = "Describe the risks in this design and the next task.";
    const storedMessage = await artifacts.put(rawMessage);
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("native/private/message-1"),
      target: {
        integrationId: "itg_native001",
        projectId,
        conversationId: "cnv_product01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_inbound_message",
        contentHash: storedMessage.contentHash,
        byteCount: storedMessage.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      mentions: { roleIds: [], participantIds: [] },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-08-20T00:30:00Z",
    });
    const policies = {
      reviewer: createConversationParticipationPolicy({
        projectId,
        roleId: "reviewer",
        conversationIds: ["cnv_product01"],
        mode: "relevant",
        respondTo: ["human"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 5,
        maxAutomationDepth: 1,
        createdAt: "2026-08-20T00:00:00Z",
      }),
      planner: createConversationParticipationPolicy({
        projectId,
        roleId: "planner",
        conversationIds: ["cnv_product01"],
        mode: "relevant",
        respondTo: ["human"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 5,
        maxAutomationDepth: 1,
        createdAt: "2026-08-20T00:00:00Z",
      }),
    };
    const decisions = {
      reviewer: createConversationParticipationDecision({
        event,
        policy: policies.reviewer,
        action: "respond",
        reason: "relevant",
        relevance: "relevant",
        decidedAt: "2026-08-20T00:31:00Z",
      }),
      planner: createConversationParticipationDecision({
        event,
        policy: policies.planner,
        action: "respond",
        reason: "relevant",
        relevance: "relevant",
        decidedAt: "2026-08-20T00:31:01Z",
      }),
    };
    const codexClient = new ConversationCodexClient(
      "codex-review-thread",
      "codex-review-turn",
      "The review found that the current design reduces risk by separating context by role.",
    );
    const claudeClient = new ConversationClaudeClient(
      "11111111-1111-4111-8111-111111111111",
      "44444444-4444-4444-8444-444444444444",
      "The next task is to connect the platform authentication adapter to this shared contract.",
    );
    const now = clock();
    const roleDocuments = {
      reviewer: { id: "doc_reviewer_context", path: "docs/reviewer.md", content: reviewerContent },
      planner: { id: "doc_planner_context", path: "docs/planner.md", content: plannerContent },
    } as const;
    const roles = { reviewer: role("reviewer"), planner: role("planner") };
    const responseArtifacts = new Map<string, WritingArtifactCoordinate>();
    const adapters = {
      reviewer: new CodexAdapter({
        repositoryRoot: root,
        clientFactory: async () => codexClient,
        resolveArtifact: (uri) => artifacts.get(uri),
        now,
        createEventId: sequence("evt_codex_bridge"),
        createReceiptId: sequence("ctx_codex_bridge"),
      }),
      planner: new ClaudeAdapter({
        repositoryRoot: root,
        clientFactory: async () => claudeClient,
        resolveArtifact: (uri) => artifacts.get(uri),
        now,
        createProviderSessionId: () => "11111111-1111-4111-8111-111111111111",
        createProviderMessageId: () => "22222222-2222-4222-8222-222222222222",
        createEventId: sequence("evt_claude_bridge"),
        createReceiptId: sequence("ctx_claude_bridge"),
      }),
    };
    const responder = new ManagedConversationResponder({
      repositoryRoot: root,
      projectId,
      policyVersion,
      events,
      artifactStore: artifacts,
      responseArtifacts: {
        get: async (requestDigest) => responseArtifacts.get(requestDigest) ?? null,
        put: async ({ requestDigest, artifact }) => {
          responseArtifacts.set(requestDigest, artifact);
        },
        remove: async (requestDigest) => {
          responseArtifacts.delete(requestDigest);
        },
      },
      semanticEvaluator: {
        async evaluate(request) {
          return {
            evaluator: { kind: "model", evaluatorId: "fixture.ko-review" },
            checks: request.checks.map((check) => ({
              checkId: check.checkId,
              status: "passed" as const,
              violationCount: 0,
            })),
          };
        },
      },
      now,
      createEventId: sequence("evt_managed_bridge"),
      resolvePlan(input) {
        const roleId = input.policy.roleId as "reviewer" | "planner";
        const roleDocument = roleDocuments[roleId];
        const registry: DocumentRegistry = {
          schemaVersion: 1,
          documents: {
            doc_writing_policy: record(writingPath),
            [roleDocument.id]: record(roleDocument.path),
          },
        };
        return {
          adapter: adapters[roleId],
          executionIdentity: {
            agentId:
              roleId === "reviewer"
                ? "agt_111111111111111111111111"
                : "agt_222222222222222222222222",
            provider: roleId === "reviewer" ? "codex" : "claude",
            model: roleId === "reviewer" ? "gpt-review" : "claude-plan",
          },
          runId: `run_conversation_${roleId}`,
          sessionId: `ses_conversation_${roleId}`,
          targetTurnId: `target-conversation-${roleId}`,
          role: roles[roleId],
          registry,
          documentRules: {
            "writing.policy": ["doc_writing_policy"],
            "role.context": [roleDocument.id],
          },
          publications: [
            publication({
              roleId,
              documentId: roleDocument.id,
              contentHash: hash(roleDocument.content),
            }),
          ],
          handoffs: [],
          writingPolicy: {
            writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
            documentId: "doc_writing_policy",
            contentHash: hash(writingContent),
          },
          writingContract: defaultEnglishWritingContract,
          resolvedSkills: [],
        };
      },
    });
    const verifier = new VerifiedConversationPublication({
      artifactStore: artifacts,
      resolveWritingContract: () => defaultEnglishWritingContract,
    });

    const reviewerRequest = {
      event,
      policy: policies.reviewer,
      decision: decisions.reviewer,
      context: {
        priorTurns: [
          {
            role: "user" as const,
            text: "Please remember that evidence comes first.",
            speaker: {
              kind: "human" as const,
              participantId: "ptc_requester01",
              agentId: null,
              roleId: null,
            },
          },
          {
            role: "assistant" as const,
            text: "I will keep that review priority.",
            speaker: {
              kind: "agent" as const,
              participantId: "ptc_reviewer01",
              agentId: "agt_111111111111111111111111",
              roleId: "reviewer",
            },
          },
        ],
      },
    };
    const [reviewer, reviewerConcurrentRetry] = await Promise.all([
      responder.respond(reviewerRequest),
      responder.respond(reviewerRequest),
    ]);
    const reviewerRetry = await responder.respond({
      ...reviewerRequest,
      decision: { ...decisions.reviewer, decisionId: `cpd_${"f".repeat(64)}` },
    });
    const planner = await responder.respond({
      event,
      policy: policies.planner,
      decision: decisions.planner,
    });
    await verifier.verify({ candidate: reviewer, event, policy: policies.reviewer });
    await verifier.verify({ candidate: planner, event, policy: policies.planner });

    expect(codexClient.startOptions).toMatchObject({
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    expect(JSON.stringify(codexClient.injectedItems)).toContain(reviewerContent.trim());
    expect(JSON.stringify(codexClient.injectedItems)).not.toContain(plannerContent.trim());
    expect(claudeClient.appendedContexts.join("\n")).toContain(plannerContent.trim());
    expect(claudeClient.appendedContexts.join("\n")).not.toContain(reviewerContent.trim());
    const codexInstructions = codexClient.instructions.replaceAll('\\"', '"');
    expect(codexInstructions).toContain(rawMessage);
    expect(codexInstructions).toContain('"provider":"codex"');
    expect(codexInstructions).toContain('"model":"gpt-review"');
    expect(codexClient.instructions).toContain("Please remember that evidence comes first.");
    expect(claudeClient.instructions).toContain(rawMessage);
    expect(claudeClient.instructions).toContain('"provider":"claude"');
    expect(claudeClient.instructions).toContain('"model":"claude-plan"');
    expect(codexClient.closed).toBe(true);
    expect(claudeClient.closed).toBe(true);
    expect(reviewer.publicationPermit.surface).toBe("chat");
    expect(reviewerConcurrentRetry.content).toEqual(reviewer.content);
    expect(reviewerRetry.content).toEqual(reviewer.content);
    expect(responseArtifacts.size).toBe(2);
    expect(planner.publicationPermit.surface).toBe("chat");

    const tampered = structuredClone(reviewer);
    tampered.publicationEvidence.evaluationArtifact.contentHash = `sha256:${"f".repeat(64)}`;
    const interactionStore = await SQLiteConversationInteractionStore.open({
      path: resolve(root, ".lervo/state/interaction.sqlite"),
    });
    await expect(
      handleConversationEvent({
        event,
        policy: policies.reviewer,
        workerId: "conversation-publication-worker",
        agentParticipantId: "ptc_agent001",
        store: interactionStore,
        responder: { respond: async () => tampered },
        publicationVerifier: verifier,
        relevanceEvaluator: { evaluate: async () => "relevant" },
        clock: () => new Date("2026-08-20T02:00:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "retry_scheduled",
      failureCode: "publication_verification_failed",
    });
    expect(interactionStore.auditIntegrity()).toMatchObject({ outboxCount: 0 });
    await interactionStore.close();

    const runEvents = events.list();
    expect(runEvents.filter((item) => item.type === "run.completed")).toHaveLength(2);
    expect(runEvents.filter((item) => item.type === "work.causality.recorded")).toHaveLength(2);
    expect(
      runEvents
        .filter((item) => item.type === "work.causality.recorded")
        .map((item) => item.payload.agentId)
        .sort(),
    ).toEqual(["agt_111111111111111111111111", "agt_222222222222222222222222"]);
    expect(runEvents.filter((item) => item.type === "context.injected")).toHaveLength(2);
    expect(JSON.stringify(runEvents)).not.toContain(rawMessage);
    expect(events.verifyIntegrity().valid).toBe(true);
    events.close();
  });
});

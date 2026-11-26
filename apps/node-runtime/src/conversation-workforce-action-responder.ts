import { createHash, randomUUID } from "node:crypto";

import {
  AgentWorkforceError,
  listAgents,
  registerAgent,
  type WorkforceAgent,
  type WorkforceEvent,
  type WorkforceProvider,
} from "@lervo/agent-workforce";
import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";
import type { ConversationWorkforceDeploymentPort } from "./discord-hired-agent-deployment.js";

type NonPlatformEffect =
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" };

interface WorkforceHireSpecification {
  name: string;
  roleId: string;
  provider: WorkforceProvider;
}

export interface ConversationWorkforceHiringPort {
  hire(input: WorkforceHireSpecification & { parentAgentId: string }): Promise<WorkforceAgent>;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function recordWorkforceEvent(storage: ProjectStorage, event: WorkforceEvent): void {
  const identity = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: digest(JSON.stringify(event.payload)),
    payload: event.payload,
  });
}

export class RepositoryConversationWorkforceHiring implements ConversationWorkforceHiringPort {
  constructor(private readonly repositoryRoot: string) {}

  async hire(input: WorkforceHireSpecification & { parentAgentId: string }) {
    const storage = await openProjectStorage(this.repositoryRoot);
    try {
      return await registerAgent({
        repositoryRoot: this.repositoryRoot,
        roleId: input.roleId,
        provider: input.provider,
        displayName: input.name,
        responsibilityPaths: ["*"],
        parentAgentId: input.parentAgentId,
        // A team agent hiring grows the team (ADR-0643).
        origin: "team",
        recordEvent: (event) => recordWorkforceEvent(storage, event),
      });
    } catch (error) {
      if (error instanceof AgentWorkforceError && error.code === "agent_state_conflict") {
        const existing = (await listAgents(this.repositoryRoot)).find(
          (agent) =>
            agent.displayName === input.name &&
            agent.roleId === input.roleId &&
            agent.provider === input.provider &&
            agent.parentAgentId === input.parentAgentId &&
            agent.status === "active",
        );
        if (existing !== undefined) return existing;
      }
      throw error;
    } finally {
      await storage.close();
    }
  }
}

function parseSpecification(value: string): WorkforceHireSpecification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The conversation workforce hiring specification is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The conversation workforce hiring specification is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "name,provider,roleId" ||
    typeof record.name !== "string" ||
    [...record.name].length < 1 ||
    [...record.name].length > 80 ||
    record.name.trim() !== record.name ||
    /[\u0000-\u001f\u007f]/u.test(record.name) ||
    typeof record.roleId !== "string" ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(record.roleId) ||
    record.roleId.length > 100 ||
    !["codex", "claude", "any"].includes(record.provider as string)
  ) {
    throw new Error("The conversation workforce hiring specification is invalid.");
  }
  return {
    name: record.name,
    roleId: record.roleId,
    provider: record.provider as WorkforceProvider,
  };
}

export class ConversationWorkforceActionResponder implements DiscordPlatformActionResponder {
  readonly availableEffects = ["none", "repository_work", "workforce_agent_hire"] as const;

  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      parentAgentId: string;
      existingConversationAgents?: readonly {
        participantId: string;
        displayName?: string;
      }[];
      hiring: ConversationWorkforceHiringPort;
      deployment?: ConversationWorkforceDeploymentPort;
      onConversationDelegateHired?(input: {
        conversationId: string;
        threadId: string | null;
        agent: WorkforceAgent;
        hiredAt: string;
      }): void;
      onDeploymentPrepared?(sourceEventId: string): void;
      now?: () => Date;
    },
  ) {}

  async respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Exclude<ConversationRequestedEffect, NonPlatformEffect>,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    if (!authorization.effectRequesterAuthorized || effect.kind !== "workforce_agent_hire") {
      throw new Error("The conversation workforce hiring action is not authorized.");
    }
    const specification = parseSpecification(effect.specification);
    const duplicate = this.options.existingConversationAgents?.find(
      (candidate) =>
        candidate.displayName !== undefined &&
        candidate.displayName.normalize("NFKC").toLocaleLowerCase("en-US") ===
          specification.name.normalize("NFKC").toLocaleLowerCase("en-US"),
    );
    if (duplicate !== undefined) {
      throw new Error(
        `A conversation agent named ${specification.name} is already routed as ${duplicate.participantId}; delegate to that exact participant instead of creating another Discord speaker.`,
      );
    }
    const agent = await this.options.hiring.hire({
      ...specification,
      parentAgentId: this.options.parentAgentId,
    });
    const deployment = await this.options.deployment?.prepare({
      agent,
      conversationId: input.event.target.conversationId,
    });
    if (deployment === undefined) {
      this.options.onConversationDelegateHired?.({
        conversationId: input.event.target.conversationId,
        threadId: input.event.target.threadId,
        agent,
        hiredAt: (this.options.now ?? (() => new Date()))().toISOString(),
      });
    }
    if (deployment?.configurationChanged === true) {
      this.options.onDeploymentPrepared?.(input.event.eventId);
    }
    const message = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const korean = /\p{Script=Hangul}/u.test(message);
    const content = korean
      ? deployment === undefined
        ? `네, ${agent.displayName}을(를) ${agent.roleId} 역할로 고용했고 이 대화의 활성 실행 담당자로 연결했습니다. 별도 Discord 발화자 배포는 구성되지 않았으며, 작업은 해당 에이전트의 독립된 공급자 세션과 맥락에서 수행됩니다.`
        : `네, ${agent.displayName}을(를) ${agent.roleId} 역할로 고용하고 별도 Discord 발화자와 독립 작업 맥락을 준비했습니다. 연결 갱신 후 이 대화에서 ${agent.displayName} 본인으로 응답하고 작업합니다.`
      : deployment === undefined
        ? `Done. I hired ${agent.displayName} as ${agent.roleId} and attached it as the active worker. No distinct Discord speaker deployment is configured; work still runs in the agent's separate provider session and context.`
        : `Done. I hired ${agent.displayName} as ${agent.roleId} with a distinct Discord speaker and independent work context. After the connection refresh, ${agent.displayName} responds and works here as itself.`;
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}

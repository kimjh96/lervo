import { createHash } from "node:crypto";

import {
  ManagedProviderRunCoordinator,
  validateManagedProviderRunEvidence,
} from "@lervo/orchestrator";
import { validateSchema } from "@lervo/schemas";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
} from "@lervo/writing";

import { readConversationMessage } from "./message-artifact.js";
import {
  ManagedConversationResponseError,
  type ManagedConversationResponsePlan,
  type ManagedConversationResponseRequest,
  type ManagedConversationResponderOptions,
  type ManagedConversationResponderPort,
} from "./types.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validateRequest(
  options: ManagedConversationResponderOptions,
  input: ManagedConversationResponseRequest,
  plan: ManagedConversationResponsePlan,
): void {
  const presentation = plan.role.outputContract.presentation;
  if (
    input.decision.action !== "respond" ||
    input.event.eventId !== input.decision.eventId ||
    input.event.target.projectId !== options.projectId ||
    input.policy.projectId !== options.projectId ||
    input.decision.projectId !== options.projectId ||
    input.policy.policyId !== input.decision.policyId ||
    input.policy.roleId !== input.decision.roleId ||
    plan.role.roleId !== input.policy.roleId ||
    plan.role.capabilities["filesystem.write"] !== "deny" ||
    plan.role.capabilities["external.message"] !== "deny" ||
    presentation.audience === "machine" ||
    presentation.writingPolicyId !== plan.writingContract.writingPolicyId ||
    plan.writingPolicy.writingPolicyId !== plan.writingContract.writingPolicyId ||
    !plan.writingContract.surfaces.includes("chat") ||
    !validateSchema("role", plan.role).valid ||
    !validateSchema("writingContract", plan.writingContract).valid
  ) {
    throw new ManagedConversationResponseError(
      "invalid_response_request",
      "대화 응답의 프로젝트, 역할, 읽기 전용 실행 또는 writing 정책이 서로 맞지 않습니다.",
    );
  }
}

function instructions(input: ManagedConversationResponseRequest, message: string): string {
  return JSON.stringify({
    task: "conversation_response",
    roleId: input.policy.roleId,
    conversationId: input.event.target.conversationId,
    threadId: input.event.target.threadId,
    participationReason: input.decision.reason,
    requirements: [
      "주입된 공통 맥락과 아래 대화 원문을 바탕으로 답합니다.",
      "읽거나 주입되지 않은 문서를 봤다고 주장하지 않습니다.",
      "외부 플랫폼에는 직접 전송하지 않고 답변 본문만 작성합니다.",
    ],
    message,
  });
}

export class ManagedConversationResponder implements ManagedConversationResponderPort {
  private readonly providerSessions = new Set<string>();

  constructor(private readonly options: ManagedConversationResponderOptions) {}

  async respond(input: ManagedConversationResponseRequest) {
    const plan = await this.options.resolvePlan(input);
    validateRequest(this.options, input, plan);
    const message = await readConversationMessage({
      content: input.event.content,
      artifactStore: this.options.artifactStore,
    });
    const requestDigest = digest(JSON.stringify({
      eventId: input.event.eventId,
      policyId: input.policy.policyId,
      decisionId: input.decision.decisionId,
      roleId: plan.role.roleId,
      messageHash: input.event.content.contentHash,
    }));
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
      instructions: instructions(input, message),
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
    const sessionKey = `${run.session.provider}:${run.session.providerSessionId}`;
    if (this.providerSessions.has(sessionKey)) {
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "대화 응답 역할에 독립 provider session이 배정되지 않았습니다.",
      );
    }
    this.providerSessions.add(sessionKey);
    if (
      run.session.executionMode !== "read_only" ||
      run.managedChanges.length !== 0 ||
      run.beforeRevision !== run.afterRevision ||
      run.session.roleId !== plan.role.roleId ||
      run.turn.targetTurnId !== plan.targetTurnId
    ) {
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "대화 응답 managed run이 읽기 전용 역할과 결과 좌표를 지키지 않았습니다.",
      );
    }
    const runEvents = this.options.events.list({ runId: plan.runId });
    const requested = runEvents.filter((event) => event.type === "run.requested");
    if (
      requested.length !== 1 ||
      requested[0]!.payload.requestDigest !== requestDigest ||
      requested[0]!.payload.role !== plan.role.roleId
    ) {
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "대화 원문 hash와 managed run 요청 원본이 서로 연결되지 않았습니다.",
      );
    }
    try {
      validateManagedProviderRunEvidence({
        run,
        events: runEvents,
        sharedContextPublications: plan.publications,
      });
    } catch (error) {
      throw new ManagedConversationResponseError(
        "managed_run_invalid",
        "대화 응답에 필요한 E2/E3 공통 맥락 증거를 확인하지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (run.resultArtifact.byteCount > 65_536) {
      throw new ManagedConversationResponseError(
        "writing_publication_blocked",
        "대화 응답이 공개 가능한 최대 크기를 넘었습니다.",
      );
    }
    const publication = await evaluateWritingPublication({
      artifact: run.resultArtifact,
      contract: plan.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
      semanticEvaluator: this.options.semanticEvaluator,
    }, this.options.now === undefined ? {} : { now: this.options.now });
    if (publication.status !== "allowed") {
      throw new ManagedConversationResponseError(
        "writing_publication_blocked",
        "Writing 검증을 통과하지 못한 provider 결과는 대화에 공개할 수 없습니다.",
      );
    }
    await readPublishableWritingArtifact({
      artifact: run.resultArtifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
      permit: publication.permit,
      contract: plan.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
    });
    return {
      content: {
        artifactId: run.resultArtifact.artifactId,
        contentHash: run.resultArtifact.contentHash,
        byteCount: run.resultArtifact.byteCount,
        mediaType: run.resultArtifact.mediaType,
      },
      publicationPermit: publication.permit,
      publicationEvidence: {
        artifact: run.resultArtifact,
        evaluation: publication.evaluation,
        evaluationArtifact: publication.evaluationArtifact,
      },
    };
  }
}

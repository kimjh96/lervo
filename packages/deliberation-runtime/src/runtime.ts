import {
  deliberationPolicyHash,
  policyAllowsProvider,
  validateDeliberationOutcome,
  validateDeliberationPolicy,
  type DeliberationVerificationEvidence,
} from "@lervo/deliberation";
import { maximumManagedRunEvidenceEvents } from "@lervo/execution-contract";
import {
  type DeliberationArtifact,
  type DeliberationArtifactKind,
  type DeliberationOutcome,
  type EventEnvelope,
  type SharedContextPublication,
} from "@lervo/schemas";
import { collectRunEventsBounded } from "@lervo/storage-contract";

import { publishDeliberationArtifact } from "./artifact-publication.js";
import { DeliberationEventRecorder } from "./event-recorder.js";
import { publishDeliberationHandoff } from "./handoff-publication.js";
import { restoreDeliberationRuntimeSnapshot } from "./runtime-snapshot.js";
import {
  DeliberationRuntimeError,
  type DeliberationRuntimeOptions,
  type DeliberationRuntimeResult,
  type DeliberationRuntimeSnapshot,
  type DeliberationTurnResult,
  type ExecuteDeliberationTurnInput,
  type PublishDeliberationHandoffInput,
  type PublishedDeliberationHandoff,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DeliberationRuntime {
  private readonly recorder: DeliberationEventRecorder;
  private readonly now: () => Date;
  private readonly artifacts: DeliberationArtifact[] = [];
  private readonly verificationEvidence: DeliberationVerificationEvidence[] = [];
  private readonly recordedEvents = new Map<string, string>();
  private readonly providerSessionRoles = new Map<string, string>();
  private readonly publishedArtifacts = new Map<string, {
    publication: SharedContextPublication;
    event: EventEnvelope;
  }>();
  private readonly publishedHandoffIds = new Set<string>();
  private readonly publishedHandoffEvents = new Map<string, string>();
  private startedEventId: string | null = null;
  private turnRunning = false;
  private started = false;
  private completed = false;

  constructor(private readonly options: DeliberationRuntimeOptions) {
    validateDeliberationPolicy(options.policy);
    if (options.policy.projectId !== options.coordinates.projectId) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "managed_run_coordinate_mismatch",
        "숙의 runtime과 policy의 project ID가 다릅니다.",
      );
    }
    this.recorder = new DeliberationEventRecorder(
      options.events,
      options.policyVersion,
      options.createEventId,
    );
    this.now = options.now ?? (() => new Date());
    if (options.resumeSnapshot !== undefined) this.restore(options.resumeSnapshot);
  }

  start(): void {
    if (this.started) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "runtime_started_twice",
        "같은 숙의 runtime을 두 번 시작할 수 없습니다.",
      );
    }
    this.assertNotCompleted();
    const event = this.recorder.append({
      type: "deliberation.started",
      coordinates: this.options.coordinates,
      occurredAt: this.time(),
      actor: { kind: "system" },
      payload: {
        deliberationId: this.options.deliberationId,
        policyId: this.options.policy.policyId,
        policyHash: deliberationPolicyHash(this.options.policy),
        participantRoleIds: this.options.policy.participants.map((item) => item.roleId),
        maxRounds: this.options.policy.maxRounds,
      },
    });
    this.startedEventId = event.eventId;
    this.started = true;
  }

  async executeTurn<K extends DeliberationArtifactKind>(
    input: ExecuteDeliberationTurnInput<K>,
  ): Promise<DeliberationTurnResult> {
    this.assertStarted();
    this.assertNotCompleted();
    this.assertIdle();
    this.turnRunning = true;
    try {
      return await this.executeTurnOnce(input);
    } finally {
      this.turnRunning = false;
    }
  }

  private async executeTurnOnce<K extends DeliberationArtifactKind>(
    input: ExecuteDeliberationTurnInput<K>,
  ): Promise<DeliberationTurnResult> {
    const previousArtifacts = input.previousArtifactIds.map((artifactId) => {
      const artifact = this.artifacts.find((candidate) =>
        candidate.deliberationArtifactId === artifactId);
      if (artifact === undefined) {
        throw new DeliberationRuntimeError(
          "runtime_state_invalid",
          "artifact_history_invalid",
          "현재 runtime 이력에 없는 이전 artifact를 참조했습니다.",
        );
      }
      return artifact;
    });
    const run = await input.executeManagedRun();
    if (!policyAllowsProvider(
      this.options.policy,
      run.session.roleId,
      run.session.provider,
    )) {
      throw new DeliberationRuntimeError(
        "artifact_publication_failed",
        "provider_not_allowed",
        "Managed run의 역할과 공급자가 숙의 정책에서 허용되지 않습니다.",
      );
    }
    const providerSessionRole = this.providerSessionRoles.get(run.session.providerSessionId);
    if (providerSessionRole !== undefined && providerSessionRole !== run.session.roleId) {
      throw new DeliberationRuntimeError(
        "context_evidence_invalid",
        "provider_session_reused",
        "서로 다른 역할이 같은 provider session을 재사용했습니다.",
      );
    }
    let runEvents: EventEnvelope[];
    try {
      runEvents = collectRunEventsBounded({
        events: this.options.events,
        runId: run.session.runId,
        maximumEvents: maximumManagedRunEvidenceEvents,
      });
    } catch (error) {
      throw new DeliberationRuntimeError(
        "context_evidence_invalid",
        "managed_run_event_missing",
        "Managed run event 원본을 허용된 범위에서 끝까지 읽지 못했습니다.",
        { cause: error },
      );
    }
    const evidence = input.verificationEvidence;
    const nextEvidence = evidence === undefined
      ? this.verificationEvidence
      : [...this.verificationEvidence, clone(evidence)];
    const createdAt = this.time();
    const published = await publishDeliberationArtifact({
      deliberationId: this.options.deliberationId,
      policy: this.options.policy,
      round: input.round,
      kind: input.kind,
      details: input.details,
      previousArtifacts,
      history: this.artifacts,
      verificationEvidence: nextEvidence,
      sharedContextPublications: input.sharedContextPublications,
      run,
      runEvents,
      writingContract: input.writingContract,
      semanticEvaluator: input.semanticEvaluator,
      artifactStore: this.options.artifactStore,
      createdAt,
    });
    const recordedEvent = this.recorder.append({
      type: "deliberation.artifact.recorded",
      coordinates: {
        projectId: published.artifact.projectId,
        runId: published.artifact.producer.runId,
        sessionId: published.artifact.producer.sessionId,
      },
      occurredAt: createdAt,
      actor: { kind: "agent", provider: published.artifact.producer.provider },
      payload: {
        deliberationId: published.artifact.deliberationId,
        deliberationArtifactId: published.artifact.deliberationArtifactId,
        kind: published.artifact.kind,
        round: published.artifact.round,
        producerRoleId: published.artifact.producer.roleId,
        artifactId: published.artifact.content.artifactId,
        contentHash: published.artifact.content.contentHash,
        writingPermitId: published.artifact.writingPublicationPermit.permitId,
      },
    });
    this.artifacts.push(clone(published.artifact));
    this.recordedEvents.set(published.artifact.deliberationArtifactId, recordedEvent.eventId);
    this.providerSessionRoles.set(run.session.providerSessionId, run.session.roleId);
    if (evidence !== undefined) this.verificationEvidence.push(clone(evidence));
    return { ...published, recordedEvent };
  }

  publishHandoff(input: PublishDeliberationHandoffInput): PublishedDeliberationHandoff {
    this.assertStarted();
    this.assertNotCompleted();
    this.assertIdle();
    if (this.publishedHandoffIds.has(input.handoff.handoffId)) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "handoff_already_published",
        "같은 숙의 handoff를 두 번 기록할 수 없습니다.",
      );
    }
    const recordedPublication = this.publishedArtifacts.get(input.artifactId);
    const result = publishDeliberationHandoff({
      request: input,
      artifact: this.artifacts.find((candidate) =>
        candidate.deliberationArtifactId === input.artifactId),
      artifactEventId: this.recordedEvents.get(input.artifactId),
      policy: this.options.policy,
      recorder: this.recorder,
      ...(recordedPublication === undefined ? {} : { recordedPublication }),
    });
    if (recordedPublication === undefined) {
      this.publishedArtifacts.set(input.artifactId, {
        publication: clone(result.publication),
        event: clone(result.publishedEvent),
      });
    }
    this.publishedHandoffIds.add(input.handoff.handoffId);
    this.publishedHandoffEvents.set(input.handoff.handoffId, result.handoffEvent.eventId);
    return result;
  }

  complete(outcome: DeliberationOutcome): DeliberationRuntimeResult {
    this.assertStarted();
    this.assertNotCompleted();
    this.assertIdle();
    validateDeliberationOutcome({
      deliberationId: this.options.deliberationId,
      policy: this.options.policy,
      artifacts: this.artifacts,
      verificationEvidence: this.verificationEvidence,
      outcome,
    });
    const completedEvent = this.recorder.append({
      type: "deliberation.completed",
      coordinates: this.options.coordinates,
      occurredAt: outcome.completedAt,
      actor: { kind: "system" },
      payload: {
        deliberationId: outcome.deliberationId,
        outcomeId: outcome.outcomeId,
        status: outcome.status,
        lastRound: outcome.lastRound,
        decisionArtifactId: outcome.decisionArtifactId,
        unresolvedBlockingObjectionIds: outcome.unresolvedBlockingObjectionIds,
        failurePhase: outcome.status === "failed" ? outcome.failure.phase : null,
        failureCode: outcome.status === "failed" ? outcome.failure.code : null,
      },
    });
    this.completed = true;
    return { outcome: clone(outcome), completedEvent };
  }

  history(): DeliberationArtifact[] {
    return clone(this.artifacts);
  }

  snapshot(): DeliberationRuntimeSnapshot {
    this.assertStarted();
    this.assertNotCompleted();
    if (this.startedEventId === null) this.snapshotInvalid();
    return clone({
      schemaVersion: 1,
      deliberationId: this.options.deliberationId,
      policyHash: deliberationPolicyHash(this.options.policy),
      startedEventId: this.startedEventId!,
      artifacts: this.artifacts,
      verificationEvidence: this.verificationEvidence,
      providerSessionRoles: [...this.providerSessionRoles].map(
        ([providerSessionId, roleId]) => ({ providerSessionId, roleId })),
      recordedEvents: [...this.recordedEvents].map(([artifactId, eventId]) => ({
        artifactId,
        eventId,
      })),
      publications: [...this.publishedArtifacts].map(([artifactId, item]) => ({
        artifactId,
        publication: item.publication,
        eventId: item.event.eventId,
      })),
      handoffs: [...this.publishedHandoffEvents].map(([handoffId, eventId]) => ({
        handoffId,
        eventId,
      })),
    });
  }

  private restore(snapshot: DeliberationRuntimeSnapshot): void {
    const restored = restoreDeliberationRuntimeSnapshot({ snapshot, options: this.options });
    this.artifacts.push(...restored.artifacts);
    this.verificationEvidence.push(...restored.verificationEvidence);
    for (const [artifactId, eventId] of restored.recordedEvents) {
      this.recordedEvents.set(artifactId, eventId);
    }
    for (const [providerSessionId, roleId] of restored.providerSessionRoles) {
      this.providerSessionRoles.set(providerSessionId, roleId);
    }
    for (const [artifactId, publication] of restored.publications) {
      this.publishedArtifacts.set(artifactId, publication);
    }
    for (const [handoffId, eventId] of restored.handoffs) {
      this.publishedHandoffIds.add(handoffId);
      this.publishedHandoffEvents.set(handoffId, eventId);
    }
    this.startedEventId = restored.startedEventId;
    this.started = true;
  }

  private snapshotInvalid(): never {
    throw new DeliberationRuntimeError(
      "runtime_state_invalid",
      "runtime_snapshot_invalid",
      "숙의 runtime snapshot이 현재 policy 또는 event 원본과 다릅니다.",
    );
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "runtime_not_started",
        "숙의 runtime을 시작한 뒤 turn을 실행해야 합니다.",
      );
    }
  }

  private assertNotCompleted(): void {
    if (this.completed) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "runtime_already_completed",
        "종료된 숙의 runtime에는 작업을 추가할 수 없습니다.",
      );
    }
  }

  private assertIdle(): void {
    if (this.turnRunning) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "operation_in_progress",
        "숙의 turn이 진행 중일 때 다른 runtime 작업을 시작할 수 없습니다.",
      );
    }
  }

  private time(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "artifact_history_invalid",
        "숙의 runtime 시각이 유효하지 않습니다.",
      );
    }
    return value.toISOString();
  }
}

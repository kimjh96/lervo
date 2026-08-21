import {
  deliberationPolicyHash,
  policyAllowsProvider,
  validateDeliberationHistory,
  validateDeliberationOutcome,
  validateDeliberationPolicy,
  type DeliberationVerificationEvidence,
} from "@lervo/deliberation";
import {
  type DeliberationArtifact,
  type DeliberationArtifactKind,
  type DeliberationOutcome,
  type EventEnvelope,
  type SharedContextPublication,
} from "@lervo/schemas";

import { publishDeliberationArtifact } from "./artifact-publication.js";
import { DeliberationEventRecorder } from "./event-recorder.js";
import { publishDeliberationHandoff } from "./handoff-publication.js";
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
    const runEvents = this.options.events.list({ runId: run.session.runId });
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
    if (
      snapshot === null || typeof snapshot !== "object" ||
      snapshot.schemaVersion !== 1 ||
      snapshot.deliberationId !== this.options.deliberationId ||
      snapshot.policyHash !== deliberationPolicyHash(this.options.policy) ||
      typeof snapshot.startedEventId !== "string" ||
      !Array.isArray(snapshot.artifacts) ||
      !Array.isArray(snapshot.verificationEvidence) ||
      !Array.isArray(snapshot.providerSessionRoles) ||
      !Array.isArray(snapshot.recordedEvents) ||
      !Array.isArray(snapshot.publications) ||
      !Array.isArray(snapshot.handoffs)
    ) this.snapshotInvalid();
    try {
      validateDeliberationHistory({
        policy: this.options.policy,
        artifacts: snapshot.artifacts,
        verificationEvidence: snapshot.verificationEvidence,
      });
    } catch {
      this.snapshotInvalid();
    }
    const started = this.options.events.get(snapshot.startedEventId);
    if (
      started?.type !== "deliberation.started" ||
      started.payload.deliberationId !== snapshot.deliberationId ||
      started.payload.policyHash !== snapshot.policyHash
    ) this.snapshotInvalid();
    const recorded = new Map(snapshot.recordedEvents.map((item) => [item.artifactId, item.eventId]));
    if (recorded.size !== snapshot.artifacts.length) this.snapshotInvalid();
    for (const artifact of snapshot.artifacts) {
      const eventId = recorded.get(artifact.deliberationArtifactId);
      const event = eventId === undefined ? null : this.options.events.get(eventId);
      if (
        event?.type !== "deliberation.artifact.recorded" ||
        event.payload.deliberationArtifactId !== artifact.deliberationArtifactId ||
        event.payload.contentHash !== artifact.content.contentHash ||
        event.payload.producerRoleId !== artifact.producer.roleId
      ) this.snapshotInvalid();
    }
    const recordedEventIds = new Set(snapshot.recordedEvents.map((item) => item.eventId));
    const allEvents = this.listAllEvents();
    const currentArtifactEvents = allEvents.filter((event) =>
      event.type === "deliberation.artifact.recorded" &&
      event.payload.deliberationId === snapshot.deliberationId);
    if (
      currentArtifactEvents.length !== recordedEventIds.size ||
      currentArtifactEvents.some((event) => !recordedEventIds.has(event.eventId))
    ) this.snapshotInvalid();
    const artifactIds = new Set(snapshot.artifacts.map((artifact) =>
      artifact.deliberationArtifactId));
    const publicationArtifactIds = new Set(snapshot.publications.map((item) => item.artifactId));
    const handoffIds = new Set(snapshot.handoffs.map((item) => item.handoffId));
    if (
      publicationArtifactIds.size !== snapshot.artifacts.length ||
      snapshot.publications.length !== snapshot.artifacts.length ||
      handoffIds.size !== snapshot.handoffs.length ||
      snapshot.handoffs.length !==
        snapshot.artifacts.length * this.options.policy.participants.length
    ) this.snapshotInvalid();
    for (const item of snapshot.publications) {
      const event = this.options.events.get(item.eventId);
      if (
        !artifactIds.has(item.artifactId) || event?.type !== "context.published" ||
        event.payload.sharedContextId !== item.publication.sharedContextId ||
        event.payload.contentHash !== item.publication.contentHash
      ) this.snapshotInvalid();
      const artifact = snapshot.artifacts.find((candidate) =>
        candidate.deliberationArtifactId === item.artifactId)!;
      const recipientRoleIds = snapshot.handoffs.flatMap((handoff) => {
        const handoffEvent = this.options.events.get(handoff.eventId);
        return handoffEvent?.type === "handoff.created" &&
          handoffEvent.runId === artifact.producer.runId &&
          handoffEvent.sessionId === artifact.producer.sessionId &&
          handoffEvent.payload.fromRoleId === artifact.producer.roleId &&
          Array.isArray(handoffEvent.payload.sharedContextIds) &&
          handoffEvent.payload.sharedContextIds.includes(item.publication.sharedContextId)
          ? [handoffEvent.payload.toRoleId]
          : [];
      });
      const expectedRoleIds = this.options.policy.participants.map((participant) =>
        participant.roleId);
      if (
        recipientRoleIds.length !== expectedRoleIds.length ||
        new Set(recipientRoleIds).size !== expectedRoleIds.length ||
        expectedRoleIds.some((roleId) => !recipientRoleIds.includes(roleId))
      ) this.snapshotInvalid();
    }
    for (const item of snapshot.handoffs) {
      const event = this.options.events.get(item.eventId);
      if (event?.type !== "handoff.created" || event.payload.handoffId !== item.handoffId) {
        this.snapshotInvalid();
      }
    }
    if (allEvents.some((event) =>
      event.type === "deliberation.completed" &&
      event.payload.deliberationId === snapshot.deliberationId)) this.snapshotInvalid();

    this.artifacts.push(...clone(snapshot.artifacts));
    this.verificationEvidence.push(...clone(snapshot.verificationEvidence));
    for (const [artifactId, eventId] of recorded) this.recordedEvents.set(artifactId, eventId);
    if (snapshot.providerSessionRoles.length !== snapshot.artifacts.length) {
      this.snapshotInvalid();
    }
    for (const item of snapshot.providerSessionRoles) {
      if (
        typeof item?.providerSessionId !== "string" || typeof item.roleId !== "string" ||
        this.providerSessionRoles.has(item.providerSessionId) ||
        !this.options.policy.participants.some((participant) => participant.roleId === item.roleId)
      ) this.snapshotInvalid();
      const producedArtifact = snapshot.artifacts.find((artifact) => {
        if (artifact.producer.roleId !== item.roleId) return false;
        return this.options.events.list({ runId: artifact.producer.runId }).some((event) =>
          event.type === "adapter.started" &&
          event.payload.providerSessionId === item.providerSessionId);
      });
      if (producedArtifact === undefined) this.snapshotInvalid();
      this.providerSessionRoles.set(item.providerSessionId, item.roleId);
    }
    for (const item of snapshot.publications) {
      this.publishedArtifacts.set(item.artifactId, {
        publication: clone(item.publication),
        event: clone(this.options.events.get(item.eventId)!),
      });
    }
    for (const item of snapshot.handoffs) {
      this.publishedHandoffIds.add(item.handoffId);
      this.publishedHandoffEvents.set(item.handoffId, item.eventId);
    }
    this.startedEventId = snapshot.startedEventId;
    this.started = true;
  }

  private snapshotInvalid(): never {
    throw new DeliberationRuntimeError(
      "runtime_state_invalid",
      "runtime_snapshot_invalid",
      "숙의 runtime snapshot이 현재 policy 또는 event 원본과 다릅니다.",
    );
  }

  private listAllEvents(): EventEnvelope[] {
    const events: EventEnvelope[] = [];
    let afterSeq = 0;
    while (true) {
      const page = this.options.events.list({ afterSeq, limit: 1_000 });
      events.push(...page);
      if (page.length < 1_000) return events;
      const next = page.at(-1)!.seq;
      if (next <= afterSeq) this.snapshotInvalid();
      afterSeq = next;
    }
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

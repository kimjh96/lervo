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
  private readonly publishedArtifacts = new Map<
    string,
    {
      publication: SharedContextPublication;
      event: EventEnvelope;
    }
  >();
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
        "The deliberation runtime and policy project IDs differ.",
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
        "The same deliberation runtime cannot be started twice.",
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
      const artifact = this.artifacts.find(
        (candidate) => candidate.deliberationArtifactId === artifactId,
      );
      if (artifact === undefined) {
        throw new DeliberationRuntimeError(
          "runtime_state_invalid",
          "artifact_history_invalid",
          "The request references a previous artifact absent from the current runtime history.",
        );
      }
      return artifact;
    });
    const run = await input.executeManagedRun();
    if (!policyAllowsProvider(this.options.policy, run.session.roleId, run.session.provider)) {
      throw new DeliberationRuntimeError(
        "artifact_publication_failed",
        "provider_not_allowed",
        "The managed run role and provider are not allowed by the deliberation policy.",
      );
    }
    const providerSessionRole = this.providerSessionRoles.get(run.session.providerSessionId);
    if (providerSessionRole !== undefined && providerSessionRole !== run.session.roleId) {
      throw new DeliberationRuntimeError(
        "context_evidence_invalid",
        "provider_session_reused",
        "Different roles reused the same provider session.",
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
        "The managed run source events could not be read completely within the allowed bounds.",
        { cause: error },
      );
    }
    const evidence = input.verificationEvidence;
    const nextEvidence =
      evidence === undefined
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
        "The same deliberation handoff cannot be recorded twice.",
      );
    }
    const recordedPublication = this.publishedArtifacts.get(input.artifactId);
    const result = publishDeliberationHandoff({
      request: input,
      artifact: this.artifacts.find(
        (candidate) => candidate.deliberationArtifactId === input.artifactId,
      ),
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
      providerSessionRoles: [...this.providerSessionRoles].map(([providerSessionId, roleId]) => ({
        providerSessionId,
        roleId,
      })),
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
      "The deliberation runtime snapshot differs from the current policy or source events.",
    );
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "runtime_not_started",
        "Start the deliberation runtime before running a turn.",
      );
    }
  }

  private assertNotCompleted(): void {
    if (this.completed) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "runtime_already_completed",
        "Work cannot be added to a completed deliberation runtime.",
      );
    }
  }

  private assertIdle(): void {
    if (this.turnRunning) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "operation_in_progress",
        "Another runtime operation cannot start while a deliberation turn is active.",
      );
    }
  }

  private time(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) {
      throw new DeliberationRuntimeError(
        "runtime_state_invalid",
        "artifact_history_invalid",
        "The deliberation runtime time is invalid.",
      );
    }
    return value.toISOString();
  }
}

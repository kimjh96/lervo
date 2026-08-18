import {
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterTurn,
  type AdapterTurnRequest,
} from "@roven/schemas";

import { ManagedContextRun } from "./managed-context-run.js";
import {
  adapterStartedSpec,
  providerSignalSpec,
  runCompletedSpec,
  runFailedSpec,
  runRequestedSpecs,
} from "./provider-run-events.js";
import {
  assertAdapterMessage,
  assertManagedSession,
  assertTerminalTurn,
  createAdapterStartRequest,
  validateManagedProviderRunInput,
} from "./provider-run-validation.js";
import {
  resolveManagedProviderRunDeadlines,
  withinDeadline,
  type ManagedProviderRunDeadlines,
} from "./provider-run-deadline.js";
import { RunFailureLedger } from "./provider-run-failures.js";
import { finalizeProviderRun } from "./provider-run-finalizer.js";
import type { ManagedProviderRunPhase } from "./provider-run-phase.js";
import {
  ManagedProviderRunError,
  type ManagedProviderRunInput,
  type ManagedProviderRunOptions,
  type ManagedProviderRunResult,
} from "./provider-run-types.js";
import {
  startProviderSignalMonitor,
  type ProviderSignalMonitor,
} from "./provider-signal-monitor.js";
import {
  captureRepositorySnapshot,
  resolveRepositorySnapshotPolicy,
  type RepositorySnapshot,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";
import { ManagedTelemetryRecorder, TelemetryWriteError } from "./telemetry.js";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function snapshotInput(input: ManagedProviderRunInput): ManagedProviderRunInput {
  const { signal, createEnvelopeId, createEvidenceReceiptId, context, ...values } = input;
  const { createReceiptId, ...contextValues } = context;
  return {
    ...copy(values),
    context: {
      ...copy(contextValues),
      ...(createReceiptId === undefined ? {} : { createReceiptId }),
    },
    ...(signal === undefined ? {} : { signal }),
    ...(createEnvelopeId === undefined ? {} : { createEnvelopeId }),
    ...(createEvidenceReceiptId === undefined ? {} : { createEvidenceReceiptId }),
  };
}

function abortPromise(signal: AbortSignal | undefined): {
  promise: Promise<never>;
  dispose: () => void;
} {
  if (signal === undefined) {
    return { promise: new Promise<never>(() => undefined), dispose: () => undefined };
  }
  let listener: () => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    listener = () =>
      reject(new ManagedProviderRunError("cancelled", "Managed run이 취소되었습니다."));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  void promise.catch(() => undefined);
  return {
    promise,
    dispose: () => signal.removeEventListener("abort", listener),
  };
}

interface ManagedProviderRunExecutionState {
  session?: AdapterSession;
  turn?: AdapterTurn;
  before?: RepositorySnapshot;
  after?: RepositorySnapshot;
}

export class ManagedProviderRunCoordinator {
  private readonly context: ManagedContextRun;
  private readonly telemetry: ManagedTelemetryRecorder;
  private readonly now: () => Date;
  private readonly captureSnapshot: NonNullable<ManagedProviderRunOptions["captureSnapshot"]>;
  private readonly snapshotPolicy: RepositorySnapshotPolicy;
  private readonly deadlines: ManagedProviderRunDeadlines;
  private running = false;

  constructor(private readonly options: ManagedProviderRunOptions) {
    this.context = new ManagedContextRun(options);
    this.telemetry = new ManagedTelemetryRecorder(
      options.events,
      options.coordinates,
      options.policyVersion,
      options.createEventId,
    );
    this.now = options.now ?? (() => new Date());
    this.captureSnapshot = options.captureSnapshot ?? captureRepositorySnapshot;
    this.snapshotPolicy = resolveRepositorySnapshotPolicy(options.snapshotPolicy);
    this.deadlines = resolveManagedProviderRunDeadlines(options.deadlines);
    assertAdapterMessage(options.adapter.descriptor, "Adapter descriptor");
  }

  async run(input: ManagedProviderRunInput): Promise<ManagedProviderRunResult> {
    if (this.running) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "같은 coordinator에서 managed run을 두 번 시작할 수 없습니다.",
      );
    }
    this.running = true;
    return this.execute(snapshotInput(input));
  }

  private async execute(input: ManagedProviderRunInput): Promise<ManagedProviderRunResult> {
    validateManagedProviderRunInput(input, this.options.coordinates);
    const state: ManagedProviderRunExecutionState = {};
    let monitor: ProviderSignalMonitor | undefined;
    let terminal: AdapterNormalizedEvent | undefined;
    const failures = new RunFailureLedger();
    let phase: ManagedProviderRunPhase = "request";

    const requestedAt = this.time();
    this.append(
      runRequestedSpecs({
        requestDigest: input.requestDigest,
        roleId: this.options.coordinates.roleId,
        risk: input.risk,
        policyVersion: this.options.policyVersion,
        occurredAt: requestedAt,
      }),
    );

    try {
      phase = "before_snapshot";
      state.before = await withinDeadline({
        operation: () => this.captureSnapshot(input.repositoryRoot, this.snapshotPolicy),
        timeoutMs: this.deadlines.snapshotMs,
        failureCode: "repository_snapshot_failed",
        label: "실행 전 repository snapshot",
      });

      phase = "adapter_start";
      const startRequest = createAdapterStartRequest({
        run: input,
        options: this.options,
        requestedAt,
      });
      state.session = await this.options.adapter.start(startRequest);
      assertManagedSession({
        request: startRequest,
        session: state.session,
        provider: this.options.adapter.descriptor.provider,
      });
      this.append([adapterStartedSpec(this.options.adapter.descriptor, state.session)]);
      monitor = startProviderSignalMonitor({
        adapter: this.options.adapter,
        session: state.session,
        onEvent: (event) => {
          this.context.handleAdapterEvent(state.session!, event, this.date());
          const spec = providerSignalSpec(event, state.session!.provider, this.time());
          if (spec !== null) this.append([spec]);
        },
      });

      phase = "context_prepare";
      await this.context.prepareContext({
        ...input.context,
        repositoryRoot: input.repositoryRoot,
        sourceRevision: state.before.revision,
        recordedAt: this.date(),
      });
      monitor.throwIfFailed();

      phase = "context_inject";
      await this.context.injectContext({
        session: state.session,
        writingPolicy: input.writingPolicy,
        targetTurnId: input.targetTurnId,
        publications: input.context.publications,
        injectContext: (session, envelope) =>
          this.options.adapter.injectContext(session, envelope),
        ...(this.options.artifactStore === undefined
          ? {}
          : { artifactStore: this.options.artifactStore }),
        ...(input.createEnvelopeId === undefined
          ? {}
          : { createEnvelopeId: input.createEnvelopeId }),
        ...(input.createEvidenceReceiptId === undefined
          ? {}
          : { createEvidenceReceiptId: input.createEvidenceReceiptId }),
        now: () => this.date(),
      });
      monitor.throwIfFailed();

      phase = "turn_start";
      const turnRequest: AdapterTurnRequest = {
        kind: "turn_request",
        schemaVersion: 1,
        adapterId: this.options.adapter.descriptor.adapterId,
        projectId: state.session.projectId,
        runId: state.session.runId,
        sessionId: state.session.sessionId,
        providerSessionId: state.session.providerSessionId,
        targetTurnId: input.targetTurnId,
        instructions: input.instructions,
        requestedAt: this.time(),
      };
      state.turn = await this.options.adapter.startTurn(state.session, turnRequest);
      assertAdapterMessage(state.turn, "Adapter turn");
      monitor.throwIfFailed();

      phase = "provider_turn";
      const cancelled = abortPromise(input.signal);
      try {
        terminal = await withinDeadline({
          operation: () => Promise.race([monitor!.terminal, cancelled.promise]),
          timeoutMs: this.deadlines.providerTurnMs,
          failureCode: "provider_turn_failed",
          label: "Provider turn 완료 대기",
        });
      } finally {
        cancelled.dispose();
      }
      assertTerminalTurn(state.turn, terminal);
      if (terminal.type === "provider.turn.failed") {
        throw new ManagedProviderRunError(
          "provider_turn_failed",
          "Provider turn이 실패했습니다.",
        );
      }
    } catch (error) {
      failures.add(error, phase);
    }

    const after = await finalizeProviderRun({
      adapter: this.options.adapter,
      ...(state.session === undefined ? {} : { session: state.session }),
      ...(monitor === undefined ? {} : { monitor }),
      ...(state.before === undefined ? {} : { before: state.before }),
      repositoryRoot: input.repositoryRoot,
      captureSnapshot: this.captureSnapshot,
      snapshotPolicy: this.snapshotPolicy,
      deadlines: this.deadlines,
      failures,
      time: () => this.time(),
      append: (specs) => this.append(specs),
    });
    if (after !== undefined) state.after = after;

    const resultError = failures.resultError();
    const primaryFailure = failures.primary;
    if (resultError !== undefined && primaryFailure !== undefined) {
      this.append([
        runFailedSpec({
          failureCode: primaryFailure.error.code,
          retryable: primaryFailure.retryable,
          failures: failures.details(),
          occurredAt: this.time(),
        }),
      ]);
      throw resultError;
    }
    if (
      terminal === undefined ||
      state.session === undefined ||
      state.turn === undefined ||
      state.before === undefined ||
      state.after === undefined
    ) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "완료된 managed run의 필수 결과가 없습니다.",
      );
    }
    this.append([runCompletedSpec({ terminalEvent: terminal, occurredAt: this.time() })]);
    return {
      status: "completed",
      session: copy(state.session),
      turn: copy(state.turn),
      terminalEventId: terminal.eventId,
      contextGeneration: this.context.snapshot().contextGeneration,
      beforeRevision: state.before.revision,
      afterRevision: state.after.revision,
    };
  }

  private append(specs: Parameters<ManagedTelemetryRecorder["append"]>[0]): void {
    try {
      this.telemetry.append(specs);
    } catch (error) {
      if (error instanceof TelemetryWriteError) {
        throw new ManagedProviderRunError(
          "telemetry_recording_failed",
          "Managed run telemetry 기록에 실패했습니다.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private date(): Date {
    const date = this.now();
    if (!Number.isFinite(date.getTime())) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "Managed run 시각이 유효하지 않습니다.",
      );
    }
    return new Date(date.getTime());
  }

  private time(): string {
    return this.date().toISOString();
  }
}

import {
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterTurn,
  type AdapterTurnResult,
  type AdapterTurnRequest,
  type ContextEvidence,
} from "@lervo/schemas";

import { ManagedContextRun } from "./managed-context-run.js";
import { createManagedWritePlan } from "./managed-write-plan.js";
import {
  adapterStartedSpec,
  providerSignalSpec,
  runCompletedSpec,
  runFailedSpec,
  runRequestedSpecs,
  skillResolvedSpecs,
  unmanagedChangeSpec,
} from "./provider-run-events.js";
import {
  assertAdapterMessage,
  assertManagedSession,
  assertManagedTurn,
  assertTerminalTurn,
  createAdapterStartRequest,
  validateManagedProviderRunInput,
  verifyManagedProviderRunApproval,
} from "./provider-run-validation.js";
import {
  resolveManagedProviderRunDeadlines,
  withinDeadline,
  type ManagedProviderRunDeadlines,
} from "./provider-run-deadline.js";
import { RunFailureLedger } from "./provider-run-failures.js";
import { finalizeProviderRun } from "./provider-run-finalizer.js";
import { collectProviderResult, storeProviderResult } from "./provider-result.js";
import { runRequiredProjectVerifications } from "./project-verification.js";
import { ManagedProviderWriteBridge } from "./provider-write-bridge.js";
import type { ManagedProviderRunPhase } from "./provider-run-phase.js";
import {
  ManagedProviderRunError,
  type ManagedProviderRunInput,
  type ManagedProviderRunOptions,
  type ManagedProviderRunResult,
} from "./provider-run-types.js";
import {
  resolveMaximumProviderSignals,
  startProviderSignalMonitor,
  type ProviderSignalMonitor,
} from "./provider-signal-monitor.js";
import {
  captureRepositorySnapshot,
  inspectManagedRepositoryChanges,
  resolveRepositorySnapshotPolicy,
  type RepositorySnapshot,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";
import { ManagedTelemetryRecorder, TelemetryWriteError } from "./telemetry.js";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function snapshotInput(input: ManagedProviderRunInput): ManagedProviderRunInput {
  const {
    signal,
    createEnvelopeId,
    createEvidenceReceiptId,
    createTargetTurnId,
    context,
    ...values
  } = input;
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
    ...(createTargetTurnId === undefined ? {} : { createTargetTurnId }),
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
      reject(new ManagedProviderRunError("cancelled", "The managed run was cancelled."));
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
  turnResult?: AdapterTurnResult;
  resultArtifact?: ManagedProviderRunResult["resultArtifact"];
  verifications: ManagedProviderRunResult["verifications"];
  contextEvidence?: readonly ContextEvidence[];
  writeBridge?: ManagedProviderWriteBridge;
}

function resolveTargetTurnIds(input: ManagedProviderRunInput): string[] {
  const turnCount = input.context.role.capabilities["filesystem.write"] === "deny"
    ? 1
    : input.context.expectedPaths.length;
  const targetTurnIds = [input.targetTurnId];
  try {
    while (targetTurnIds.length < turnCount) {
      targetTurnIds.push(input.createTargetTurnId!());
    }
  } catch (error) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Could not create the managed multi-file turn ID.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (
    targetTurnIds.some((targetTurnId) =>
      typeof targetTurnId !== "string" || targetTurnId.length === 0
    ) || new Set(targetTurnIds).size !== targetTurnIds.length
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Managed multi-file turn IDs are empty or duplicated.",
    );
  }
  return targetTurnIds;
}

export class ManagedProviderRunCoordinator {
  private readonly context: ManagedContextRun;
  private readonly telemetry: ManagedTelemetryRecorder;
  private readonly now: () => Date;
  private readonly captureSnapshot: NonNullable<ManagedProviderRunOptions["captureSnapshot"]>;
  private readonly snapshotPolicy: RepositorySnapshotPolicy;
  private readonly deadlines: ManagedProviderRunDeadlines;
  private readonly maximumProviderSignals: number;
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
    this.maximumProviderSignals = resolveMaximumProviderSignals(options.maximumProviderSignals);
    assertAdapterMessage(options.adapter.descriptor, "Adapter descriptor");
  }

  async run(input: ManagedProviderRunInput): Promise<ManagedProviderRunResult> {
    if (this.running) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "A managed run cannot be started twice on the same coordinator.",
      );
    }
    this.running = true;
    return this.execute(snapshotInput(input));
  }

  private async execute(input: ManagedProviderRunInput): Promise<ManagedProviderRunResult> {
    validateManagedProviderRunInput(input, this.options);
    const targetTurnIds = resolveTargetTurnIds(input);
    const state: ManagedProviderRunExecutionState = { verifications: [] };
    let monitor: ProviderSignalMonitor | undefined;
    let terminal: AdapterNormalizedEvent | undefined;
    const failures = new RunFailureLedger();
    let phase: ManagedProviderRunPhase = "request";

    const requestedAt = this.time();
    this.append([
      ...runRequestedSpecs({
        requestDigest: input.requestDigest,
        roleId: this.options.coordinates.roleId,
        risk: input.risk,
        policyVersion: this.options.policyVersion,
        occurredAt: requestedAt,
      }),
      ...skillResolvedSpecs(input.resolvedSkills, requestedAt),
    ]);

    try {
      phase = "approval_preflight";
      await verifyManagedProviderRunApproval({
        run: input,
        options: this.options,
        evaluatedAt: requestedAt,
      });

      phase = "before_snapshot";
      state.before = await withinDeadline({
        operation: () => this.captureSnapshot(input.repositoryRoot, this.snapshotPolicy),
        timeoutMs: this.deadlines.snapshotMs,
        failureCode: "repository_snapshot_failed",
        label: "pre-run repository snapshot",
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
        descriptorCapabilities: this.options.adapter.descriptor.capabilities,
      });
      this.append([adapterStartedSpec(this.options.adapter.descriptor, state.session)]);
      monitor = startProviderSignalMonitor({
        adapter: this.options.adapter,
        session: state.session,
        maximumEvents: this.maximumProviderSignals,
        onEvent: (event) => {
          this.context.handleAdapterEvent(state.session!, event, this.date());
          const spec = providerSignalSpec(event, state.session!.provider, this.time());
          if (spec !== null) this.append([spec]);
        },
      });

      phase = "write_bridge";
      const writePlan = createManagedWritePlan({
        executionMode: state.session.executionMode,
        expectedPaths: input.context.expectedPaths,
      });
      state.writeBridge = new ManagedProviderWriteBridge({
        session: state.session,
        currentTurn: () => state.turn,
        context: this.context,
        plan: writePlan,
        repositoryRoot: input.repositoryRoot,
        risk: input.risk,
        requestDigest: input.requestDigest,
        verificationSuiteIds: input.context.role.verification.suiteIds,
        ...(input.approvalAuthorization === undefined
          ? {}
          : { approvalAuthorization: input.approvalAuthorization }),
        publications: input.context.publications,
        now: () => this.date(),
      });
      const scheduledPaths: Array<string | null> = writePlan.executionMode === "read_only"
        ? [null]
        : [...writePlan.allowedPaths];
      let contextSnapshot = state.before;
      for (let index = 0; index < scheduledPaths.length; index += 1) {
        const expectedPath = scheduledPaths[index]!;
        const targetTurnId = targetTurnIds[index]!;

        phase = "context_prepare";
        await this.context.prepareContext({
          ...input.context,
          repositoryRoot: input.repositoryRoot,
          sourceRevision: contextSnapshot.revision,
          recordedAt: this.date(),
        });
        monitor.throwIfFailed();

        phase = "context_inject";
        const injected = await this.context.injectContext({
          session: state.session,
          writingPolicy: input.writingPolicy,
          targetTurnId,
          publications: input.context.publications,
          injectContext: (session, envelope) =>
            this.options.adapter.injectContext(session, envelope),
          artifactStore: this.options.artifactStore,
          ...(input.createEnvelopeId === undefined
            ? {}
            : { createEnvelopeId: input.createEnvelopeId }),
          ...(input.createEvidenceReceiptId === undefined
            ? {}
            : { createEvidenceReceiptId: input.createEvidenceReceiptId }),
          now: () => this.date(),
        });
        state.contextEvidence = copy(injected.evidence);
        monitor.throwIfFailed();
        if (index === 0) {
          phase = "write_bridge";
          await this.options.adapter.attachManagedWriteBridge(
            state.session,
            state.writeBridge,
          );
        }
        if (expectedPath !== null) state.writeBridge.beginTurn(expectedPath);

        phase = "turn_start";
        const turnRequest: AdapterTurnRequest = {
          kind: "turn_request",
          schemaVersion: 1,
          adapterId: this.options.adapter.descriptor.adapterId,
          projectId: state.session.projectId,
          runId: state.session.runId,
          sessionId: state.session.sessionId,
          providerSessionId: state.session.providerSessionId,
          targetTurnId,
          instructions: expectedPath === null || scheduledPaths.length === 1
            ? input.instructions
            : [
                input.instructions,
                "",
                `Lervo managed file ${index + 1}/${scheduledPaths.length}: ${expectedPath}`,
                "Change only the repository-relative path above in this turn.",
              ].join("\n"),
          requestedAt: this.time(),
        };
        let acceptedTurn: AdapterTurn | undefined;
        const returnedTurn = await this.options.adapter.startTurn(
          state.session,
          turnRequest,
          (turn) => {
            if (acceptedTurn !== undefined) {
              throw new ManagedProviderRunError(
                "contract_validation_failed",
                "The adapter accepted the same turn twice.",
              );
            }
            assertManagedTurn({ request: turnRequest, session: state.session!, turn });
            acceptedTurn = copy(turn);
            state.turn = copy(turn);
          },
        );
        if (acceptedTurn === undefined) {
          throw new ManagedProviderRunError(
            "contract_validation_failed",
            "The adapter did not report turn acceptance before provider execution.",
          );
        }
        assertManagedTurn({ request: turnRequest, session: state.session, turn: returnedTurn });
        if (JSON.stringify(returnedTurn) !== JSON.stringify(acceptedTurn)) {
          throw new ManagedProviderRunError(
            "contract_validation_failed",
            "The turn reported by the adapter differs from the returned turn.",
          );
        }
        const managedTurn = state.turn;
        if (managedTurn === undefined) {
          throw new ManagedProviderRunError(
            "contract_validation_failed",
            "The accepted adapter turn is absent from the execution state.",
          );
        }
        monitor.throwIfFailed();

        phase = "provider_turn";
        const cancelled = abortPromise(input.signal);
        try {
          terminal = await withinDeadline({
            operation: () => Promise.race([monitor!.waitForTerminal(), cancelled.promise]),
            timeoutMs: this.deadlines.providerTurnMs,
            failureCode: "provider_turn_failed",
            label: "provider turn completion wait",
          });
        } finally {
          cancelled.dispose();
        }
        assertTerminalTurn(managedTurn, terminal);
        if (terminal.type === "provider.turn.failed") {
          throw new ManagedProviderRunError(
            "provider_turn_failed",
            "The provider turn failed.",
          );
        }
        if (expectedPath !== null) state.writeBridge.assertTurnSettled(expectedPath);
        monitor.throwIfFailed();

        if (index < scheduledPaths.length - 1) {
          phase = "after_snapshot";
          contextSnapshot = await withinDeadline({
            operation: () => this.captureSnapshot(input.repositoryRoot, this.snapshotPolicy),
            timeoutMs: this.deadlines.snapshotMs,
            failureCode: "repository_snapshot_failed",
            label: "managed multi-file intermediate repository snapshot",
          });
          const inspection = inspectManagedRepositoryChanges({
            before: state.before,
            after: contextSnapshot,
            managedChanges: state.writeBridge.evidence(),
          });
          if (inspection.invalidManagedPaths.length > 0) {
            throw new ManagedProviderRunError(
              "provider_write_failed",
              "The verified provider change differs from the intermediate snapshot.",
              { paths: inspection.invalidManagedPaths },
            );
          }
          if (inspection.unmanagedPaths.length > 0) {
            this.append([unmanagedChangeSpec({
              paths: inspection.unmanagedPaths,
              beforeRevision: state.before.revision,
              afterRevision: contextSnapshot.revision,
              detectedAt: this.time(),
            })]);
            throw new ManagedProviderRunError(
              "unmanaged_change_detected",
              "An unmanaged change was detected before the next managed file turn.",
              { paths: inspection.unmanagedPaths },
            );
          }
        }
      }
      state.writeBridge.assertSettled();
      phase = "result_collect";
      state.turnResult = await collectProviderResult({
        adapter: this.options.adapter,
        session: state.session,
        turn: state.turn!,
      });
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
      managedChanges: state.writeBridge?.evidence() ?? [],
      time: () => this.time(),
      append: (specs) => this.append(specs),
    });
    if (after !== undefined) state.after = after;

    await this.persistOutputs(input, state, failures);
    return this.complete(input, state, terminal, failures);
  }

  private async persistOutputs(
    input: ManagedProviderRunInput,
    state: ManagedProviderRunExecutionState,
    failures: RunFailureLedger,
  ): Promise<void> {
    if (failures.empty && state.turnResult !== undefined) {
      try {
        state.resultArtifact = await storeProviderResult({
          result: state.turnResult,
          artifactStore: this.options.artifactStore,
        });
      } catch (error) {
        failures.add(error, "result_store");
      }
    }
    if (
      !failures.empty || state.resultArtifact === undefined || state.after === undefined ||
      input.verificationSuites === undefined || this.options.projectVerifier === undefined
    ) return;
    try {
      state.verifications = await runRequiredProjectVerifications({
        suites: input.verificationSuites,
        verifier: this.options.projectVerifier,
        repositoryRoot: input.repositoryRoot,
        repositoryRevision: state.after.revision,
        artifactStore: this.options.artifactStore,
        failureDisposition: input.context.role.verification.failureDisposition,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        time: () => this.time(),
        append: (specs) => this.append(specs),
      });
    } catch (error) {
      failures.add(error, "project_verification");
    }
  }

  private complete(
    input: ManagedProviderRunInput,
    state: ManagedProviderRunExecutionState,
    terminal: AdapterNormalizedEvent | undefined,
    failures: RunFailureLedger,
  ): ManagedProviderRunResult {
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
      state.resultArtifact === undefined ||
      state.before === undefined ||
      state.after === undefined ||
      state.contextEvidence === undefined
    ) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "A required result is missing from the completed managed run.",
      );
    }
    const verificationStatus = input.verificationSuites === undefined
      ? "not_run" as const
      : state.verifications.every((item) => item.result.status === "passed") &&
          state.verifications.length === input.verificationSuites.length
        ? "passed" as const
        : "failed" as const;
    this.append([runCompletedSpec({
      resultArtifact: state.resultArtifact,
      verificationStatus,
      verificationArtifactIds: state.verifications.map((item) =>
        item.resultArtifact.artifactId),
      occurredAt: this.time(),
    })]);
    return {
      status: "completed",
      session: copy(state.session),
      turn: copy(state.turn),
      terminalEventId: terminal.eventId,
      resultArtifact: copy(state.resultArtifact),
      contextEvidence: copy(state.contextEvidence),
      managedChanges: state.writeBridge?.evidence() ?? [],
      contextGeneration: this.context.snapshot().contextGeneration,
      beforeRevision: state.before.revision,
      afterRevision: state.after.revision,
      verificationStatus,
      verifications: copy(state.verifications),
    };
  }

  private append(specs: Parameters<ManagedTelemetryRecorder["append"]>[0]): void {
    try {
      this.telemetry.append(specs);
    } catch (error) {
      if (error instanceof TelemetryWriteError) {
        throw new ManagedProviderRunError(
          "telemetry_recording_failed",
          "Failed to record managed run telemetry.",
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
        "The managed run time is invalid.",
      );
    }
    return new Date(date.getTime());
  }

  private time(): string {
    return this.date().toISOString();
  }
}

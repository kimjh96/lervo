import {
  type AdapterCapabilityActivationReceipt,
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterTurn,
  type AdapterTurnResult,
  type AdapterTurnRequest,
  type ContextEvidence,
} from "@lervo/schemas";
import type { InjectedContext } from "@lervo/context-delivery";

import { ManagedContextRun } from "./managed-context-run.js";
import { observeManagedProviderProcess } from "./provider-process-observation.js";
import { managedResultReferenceSpecs } from "./managed-context-reference.js";
import { createManagedWritePlan } from "./managed-write-plan.js";
import {
  adapterStartedSpec,
  capabilityActivatedSpecs,
  capabilityResolutionSpecs,
  capabilityInvocationSpecs,
  providerSignalSpec,
  runCompletedSpec,
  runFailedSpec,
  runRequestedSpecs,
  skillResolvedSpecs,
  skillInvokedSpecs,
  skillCompletedSpecs,
  unmanagedChangeSpec,
} from "./provider-run-events.js";
import {
  assertAdapterMessage,
  assertCapabilityActivationReceipts,
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
import { persistProviderFailureDiagnostic } from "./provider-failure-diagnostic.js";
import { prepareRoleInputBinding } from "./role-input-binding.js";
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
import { admitManagedWorkCausality } from "./work-causality-admission.js";
import { ManagedResourceObservation } from "./resource-observation.js";
import { ManagedStageObservation } from "./stage-observation.js";

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
  publicationContent?: string;
  resultArtifact?: ManagedProviderRunResult["resultArtifact"];
  verifications: ManagedProviderRunResult["verifications"];
  contextEvidence?: readonly ContextEvidence[];
  injected?: InjectedContext;
  capabilityActivations: AdapterCapabilityActivationReceipt[];
  writeBridge?: ManagedProviderWriteBridge;
}

function resolveTargetTurnIds(input: ManagedProviderRunInput): string[] {
  const turnCount =
    input.context.role.capabilities["filesystem.write"] === "deny"
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
    targetTurnIds.some(
      (targetTurnId) => typeof targetTurnId !== "string" || targetTurnId.length === 0,
    ) ||
    new Set(targetTurnIds).size !== targetTurnIds.length
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
    const state: ManagedProviderRunExecutionState = {
      verifications: [],
      capabilityActivations: [],
    };
    let monitor: ProviderSignalMonitor | undefined;
    let terminal: AdapterNormalizedEvent | undefined;
    const failures = new RunFailureLedger();
    let phase: ManagedProviderRunPhase = "request";

    const requestedAt = this.time();
    let workCausality;
    try {
      workCausality = admitManagedWorkCausality({
        events: this.options.events,
        coordinates: this.options.coordinates,
        ...(input.workCausality === undefined ? {} : { request: input.workCausality }),
        occurredAt: requestedAt,
      });
    } catch (error) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "The managed work causality admission failed.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    this.append([
      workCausality.spec,
      ...runRequestedSpecs({
        requestDigest: input.requestDigest,
        roleId: this.options.coordinates.roleId,
        risk: input.risk,
        policyVersion: this.options.policyVersion,
        occurredAt: requestedAt,
      }),
      ...skillResolvedSpecs(input.resolvedSkills, requestedAt),
      ...capabilityResolutionSpecs({
        recommendations: input.capabilityRecommendations ?? [],
        capabilities: input.resolvedCapabilities ?? [],
        queryDigest: input.requestDigest,
        occurredAt: requestedAt,
      }),
    ]);
    const resourceObservation = new ManagedResourceObservation(
      this.options.adapter.descriptor,
      this.options.adapter.resourceAccounting,
      this.options.coordinates,
      workCausality.payload,
    );
    const stageObservation = new ManagedStageObservation({
      descriptor: this.options.adapter.descriptor,
      lervoBuildDigest: this.options.policyVersion,
      ...(this.options.stageTiming === undefined ? {} : { timing: this.options.stageTiming }),
    });

    try {
      if (input.roleInput !== undefined) {
        phase = "context_prepare";
        this.append([
          await prepareRoleInputBinding({
            binding: input.roleInput,
            roleId: this.options.coordinates.roleId,
            artifacts: this.options.artifactStore,
            now: this.time(),
          }),
        ]);
      }
      phase = "resource_descriptor_store";
      await resourceObservation.persistDescriptor(this.options.artifactStore);

      phase = "stage_profile_store";
      await stageObservation.persistProfile(this.options.artifactStore);

      phase = "approval_preflight";
      await verifyManagedProviderRunApproval({
        run: input,
        options: this.options,
        evaluatedAt: requestedAt,
      });

      phase = "before_snapshot";
      state.before = await stageObservation.measure("repository_snapshot", () =>
        withinDeadline({
          operation: () => this.captureSnapshot(input.repositoryRoot, this.snapshotPolicy),
          timeoutMs: this.deadlines.snapshotMs,
          failureCode: "repository_snapshot_failed",
          label: "pre-run repository snapshot",
        }),
      );

      phase = "adapter_start";
      const startRequest = createAdapterStartRequest({
        run: input,
        options: this.options,
        requestedAt,
      });
      state.session = await stageObservation.measure("provider_start", () =>
        this.options.adapter.start(startRequest),
      );
      assertManagedSession({
        request: startRequest,
        session: state.session,
        provider: this.options.adapter.descriptor.provider,
        descriptorCapabilities: this.options.adapter.descriptor.capabilities,
      });
      this.append([
        adapterStartedSpec(this.options.adapter.descriptor, state.session),
        observeManagedProviderProcess({
          adapter: this.options.adapter,
          session: state.session,
          phase: "session_started",
        }),
      ]);
      monitor = startProviderSignalMonitor({
        adapter: this.options.adapter,
        session: state.session,
        maximumEvents: this.maximumProviderSignals,
        onEvent: (event) => {
          resourceObservation.observe(event);
          this.context.handleAdapterEvent(state.session!, event, this.date());
          const spec = providerSignalSpec(event, state.session!.provider, this.time());
          if (spec !== null) this.append([spec]);
          const capabilitySpecs = capabilityInvocationSpecs({
            event,
            requests: input.capabilityActivations ?? [],
            receipts: state.capabilityActivations,
            provider: state.session!.provider,
            recordedAt: this.time(),
          });
          if (capabilitySpecs.length > 0) this.append(capabilitySpecs);
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
      const scheduledPaths: Array<string | null> =
        writePlan.executionMode === "read_only" ? [null] : [...writePlan.allowedPaths];
      let contextSnapshot = state.before;
      for (let index = 0; index < scheduledPaths.length; index += 1) {
        const expectedPath = scheduledPaths[index]!;
        const targetTurnId = targetTurnIds[index]!;

        phase = "context_prepare";
        const contextRepositoryRoot = input.contextRepositoryRoot ?? input.repositoryRoot;
        const contextRevision =
          contextRepositoryRoot === input.repositoryRoot
            ? contextSnapshot.revision
            : (
                await stageObservation.measure("repository_snapshot", () =>
                  withinDeadline({
                    operation: () =>
                      this.captureSnapshot(contextRepositoryRoot, this.snapshotPolicy),
                    timeoutMs: this.deadlines.snapshotMs,
                    failureCode: "repository_snapshot_failed",
                    label: "context source repository snapshot",
                  }),
                )
              ).revision;
        await stageObservation.measure("corpus_preparation", () =>
          this.context.prepareContext({
            ...input.context,
            repositoryRoot: contextRepositoryRoot,
            writeRepositoryRoot: input.repositoryRoot,
            sourceRevision: contextRevision,
            recordedAt: this.date(),
          }),
        );
        monitor.throwIfFailed();

        phase = "context_inject";
        const injected = await stageObservation.measure("context_injection", () =>
          this.context.injectContext({
            session: state.session!,
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
          }),
        );
        state.contextEvidence = copy(injected.evidence);
        state.injected = copy(injected);
        monitor.throwIfFailed();
        if (index === 0) {
          phase = "capability_activation";
          state.capabilityActivations = await withinDeadline({
            operation: () => {
              const confirm = this.options.adapter.confirmCapabilityActivation;
              if (confirm === undefined) {
                if ((input.capabilityActivations ?? []).length === 0) return Promise.resolve([]);
                return Promise.reject(
                  new ManagedProviderRunError(
                    "capability_activation_failed",
                    "The provider adapter cannot confirm requested capability activation.",
                  ),
                );
              }
              return confirm.call(this.options.adapter, state.session!);
            },
            timeoutMs: this.deadlines.capabilityActivationMs,
            failureCode: "capability_activation_failed",
            label: "provider capability activation confirmation",
          });
          assertCapabilityActivationReceipts({
            requests: input.capabilityActivations ?? [],
            receipts: state.capabilityActivations,
            session: state.session,
          });
          this.append(
            capabilityActivatedSpecs(state.capabilityActivations, state.session.provider),
          );
          phase = "write_bridge";
          await this.options.adapter.attachManagedWriteBridge(state.session, state.writeBridge);
        }
        if (expectedPath !== null) state.writeBridge.beginTurn(expectedPath);

        if (index === 0)
          this.append(skillInvokedSpecs(input.resolvedSkills, input.requestDigest, this.time()));

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
          instructions:
            expectedPath === null
              ? input.instructions
              : [
                  input.instructions,
                  "",
                  `Lervo managed file ${index + 1}/${scheduledPaths.length}: ${expectedPath}`,
                  "Change only the repository-relative path above in this turn.",
                  "Submit its complete change through exactly one provider file-change request; a second request fails the run.",
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
          terminal = await stageObservation.measure("provider_turn", () =>
            withinDeadline({
              operation: () => Promise.race([monitor!.waitForTerminal(), cancelled.promise]),
              timeoutMs: this.deadlines.providerTurnMs,
              failureCode: "provider_turn_failed",
              label: "provider turn completion wait",
            }),
          );
        } finally {
          cancelled.dispose();
        }
        assertTerminalTurn(managedTurn, terminal);
        this.append([
          observeManagedProviderProcess({
            adapter: this.options.adapter,
            session: state.session,
            phase: "turn_terminal",
          }),
        ]);
        if (terminal.type === "provider.turn.failed") {
          throw new ManagedProviderRunError("provider_turn_failed", "The provider turn failed.");
        }
        if (expectedPath !== null) state.writeBridge.assertTurnSettled(expectedPath);
        monitor.throwIfFailed();

        if (index < scheduledPaths.length - 1) {
          phase = "after_snapshot";
          contextSnapshot = await stageObservation.measure("repository_snapshot", () =>
            withinDeadline({
              operation: () => this.captureSnapshot(input.repositoryRoot, this.snapshotPolicy),
              timeoutMs: this.deadlines.snapshotMs,
              failureCode: "repository_snapshot_failed",
              label: "managed multi-file intermediate repository snapshot",
            }),
          );
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
            this.append([
              unmanagedChangeSpec({
                paths: inspection.unmanagedPaths,
                beforeRevision: state.before.revision,
                afterRevision: contextSnapshot.revision,
                detectedAt: this.time(),
              }),
            ]);
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
      resourceObservation.observeModelIdentity(state.turnResult.modelIdentity);
      if (state.injected === undefined || state.contextEvidence === undefined) {
        throw new ManagedProviderRunError(
          "contract_validation_failed",
          "The managed result has no matching injected context.",
        );
      }
      const reference = managedResultReferenceSpecs({
        sourceEventId: this.telemetry.reserveEventId(),
        session: state.session,
        turn: state.turn!,
        result: state.turnResult,
        injected: state.injected,
        ...(input.createEvidenceReceiptId === undefined
          ? {}
          : { createEvidenceReceiptId: input.createEvidenceReceiptId }),
      });
      this.append(reference.specs);
      state.contextEvidence = [...state.contextEvidence, ...reference.evidence];
      state.publicationContent = reference.publicationContent;
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
      measureStage: (stageId, operation) => stageObservation.measure(stageId, operation),
    });
    if (after !== undefined) state.after = after;

    await this.persistOutputs(input, state, failures, stageObservation);
    return this.complete(
      input,
      state,
      terminal,
      failures,
      workCausality.payload,
      resourceObservation,
      stageObservation,
    );
  }

  private async persistOutputs(
    input: ManagedProviderRunInput,
    state: ManagedProviderRunExecutionState,
    failures: RunFailureLedger,
    stageObservation: ManagedStageObservation,
  ): Promise<void> {
    if (
      failures.empty &&
      state.turnResult !== undefined &&
      state.publicationContent !== undefined
    ) {
      try {
        state.resultArtifact = await storeProviderResult({
          result: state.turnResult,
          publicationContent: state.publicationContent,
          artifactStore: this.options.artifactStore,
        });
        this.append(
          skillCompletedSpecs(
            input.resolvedSkills,
            state.resultArtifact.artifactId,
            state.resultArtifact.contentHash,
            this.time(),
          ),
        );
      } catch (error) {
        failures.add(error, "result_store");
      }
    }
    if (
      !failures.empty ||
      state.resultArtifact === undefined ||
      state.after === undefined ||
      input.verificationSuites === undefined ||
      this.options.projectVerifier === undefined
    )
      return;
    try {
      state.verifications = await stageObservation.measure("verification", () =>
        runRequiredProjectVerifications({
          suites: input.verificationSuites!,
          verifier: this.options.projectVerifier!,
          repositoryRoot: input.repositoryRoot,
          repositoryRevision: state.after!.revision,
          producedArtifact: state.resultArtifact!,
          artifactStore: this.options.artifactStore,
          failureDisposition: input.context.role.verification.failureDisposition,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          time: () => this.time(),
          append: (specs) => this.append(specs),
        }),
      );
    } catch (error) {
      failures.add(error, "project_verification");
    }
  }

  private async complete(
    input: ManagedProviderRunInput,
    state: ManagedProviderRunExecutionState,
    terminal: AdapterNormalizedEvent | undefined,
    failures: RunFailureLedger,
    workCausality: ManagedProviderRunResult["workCausality"],
    resourceObservation: ManagedResourceObservation,
    stageObservation: ManagedStageObservation,
  ): Promise<ManagedProviderRunResult> {
    if (!failures.empty) {
      try {
        await persistProviderFailureDiagnostic(this.options.artifactStore, failures.details());
      } catch (error) {
        failures.add(error, "result_store");
      }
    }
    const resultError = failures.resultError();
    const primaryFailure = failures.primary;
    if (resultError !== undefined && primaryFailure !== undefined) {
      const resourceEvent = resourceObservation.event(this.time());
      const stageEvent = stageObservation.event(workCausality.workId, this.time(), "failed");
      this.append([
        ...(resourceEvent === null ? [] : [resourceEvent]),
        ...(stageEvent === null ? [] : [stageEvent]),
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
    const verificationStatus =
      input.verificationSuites === undefined
        ? ("not_run" as const)
        : state.verifications.every((item) => item.result.status === "passed") &&
            state.verifications.length === input.verificationSuites.length
          ? ("passed" as const)
          : ("failed" as const);
    const resourceEvent = resourceObservation.event(this.time());
    if (resourceEvent === null) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "The resource accounting descriptor was not persisted for a completed run.",
      );
    }
    const stageEvent = stageObservation.event(workCausality.workId, this.time(), "completed");
    if (stageEvent === null) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "The execution environment profile was not persisted for a completed run.",
      );
    }
    this.append([
      resourceEvent,
      stageEvent,
      runCompletedSpec({
        resultArtifact: state.resultArtifact,
        verificationStatus,
        verificationArtifactIds: state.verifications.map((item) => item.resultArtifact.artifactId),
        occurredAt: this.time(),
      }),
    ]);
    return {
      status: "completed",
      workCausality: copy(workCausality),
      session: copy(state.session),
      turn: copy(state.turn),
      terminalEventId: terminal.eventId,
      resultArtifact: copy(state.resultArtifact),
      modelIdentity: copy(state.turnResult!.modelIdentity),
      contextEvidence: copy(state.contextEvidence),
      capabilityActivations: copy(state.capabilityActivations),
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

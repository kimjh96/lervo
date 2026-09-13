import { isAbsolute } from "node:path";
import {
  assertLoadedContextIntegrity,
  prepareContext as prepareContextDocuments,
  type LoadedContext,
} from "@lervo/context";
import { injectLoadedContext, type InjectedContext } from "@lervo/context-delivery";
import type { AdapterNormalizedEvent, AdapterSession } from "@lervo/schemas";

import { adapterInvalidationReason } from "./adapter-signals.js";
import {
  injectedContextEventSpec,
  preparedContextEventSpecs,
  runtimeInvalidationEventSpec,
} from "./event-specs.js";
import { ManagedContextState } from "./state.js";
import { ManagedTelemetryRecorder } from "./telemetry.js";
import {
  type FileChangeRecord,
  type FileWriteRequest,
  ManagedContextError,
  type ManagedContextInvalidationReason,
  type ManagedContextRunOptions,
  type ManagedContextSnapshot,
  type ManagedInjectContextInput,
  type ManagedPrepareContextInput,
  type ManagedWriteDecision,
  type ManagedFileChangeEvidence,
} from "./types.js";
import {
  assertPreparedBinding,
  normalizeExpectedWritePaths,
  validateRunOptions,
} from "./validation.js";
import { ManagedWriteController } from "./write-controller.js";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function snapshotPrepareInput(input: ManagedPrepareContextInput): ManagedPrepareContextInput {
  const { createReceiptId, ...values } = input;
  return {
    ...copy(values),
    ...(createReceiptId === undefined ? {} : { createReceiptId }),
  };
}

function snapshotInjectInput(input: ManagedInjectContextInput): ManagedInjectContextInput {
  return {
    ...input,
    session: copy(input.session),
    writingPolicy: copy(input.writingPolicy),
    publications: copy(input.publications),
  };
}

export class ManagedContextRun {
  private readonly state: ManagedContextState;
  private readonly telemetry: ManagedTelemetryRecorder;
  private readonly writes: ManagedWriteController;
  private activeOperation: string | undefined;

  constructor(private readonly options: ManagedContextRunOptions) {
    this.state = new ManagedContextState(validateRunOptions(options));
    this.telemetry = new ManagedTelemetryRecorder(
      options.events,
      options.coordinates,
      options.policyVersion,
      options.createEventId,
    );
    this.writes = new ManagedWriteController(
      this.state,
      options.coordinates,
      (specs) => this.append(specs),
      (reason, occurredAt) => this.invalidateAll(reason, occurredAt),
      options.approvalVerifier,
    );
  }

  snapshot(): ManagedContextSnapshot {
    return this.state.snapshot();
  }

  private append(specs: Parameters<ManagedTelemetryRecorder["append"]>[0]) {
    try {
      return this.telemetry.append(specs);
    } catch (error) {
      return this.state.failTelemetry(error);
    }
  }

  private async runExclusive<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation !== undefined) {
      throw new ManagedContextError(
        "invalid_state",
        `The managed run ${this.activeOperation} operation is still in progress.`,
      );
    }
    this.activeOperation = name;
    try {
      return await operation();
    } finally {
      this.activeOperation = undefined;
    }
  }

  async prepareContext(input: ManagedPrepareContextInput): Promise<LoadedContext> {
    const snapshot = snapshotPrepareInput(input);
    return this.runExclusive("prepare_context", () => this.prepareContextOnce(snapshot));
  }

  private async prepareContextOnce(input: ManagedPrepareContextInput): Promise<LoadedContext> {
    this.state.assertPhase("awaiting_context");
    if (
      input.writeRepositoryRoot !== undefined &&
      (typeof input.writeRepositoryRoot !== "string" ||
        !isAbsolute(input.writeRepositoryRoot) ||
        input.writeRepositoryRoot.includes("\0"))
    )
      throw new ManagedContextError(
        "invalid_state",
        "The managed write repository must be an absolute path.",
      );
    if (
      this.state.writeRepositoryRoot !== undefined &&
      this.state.writeRepositoryRoot !== (input.writeRepositoryRoot ?? input.repositoryRoot)
    )
      throw new ManagedContextError(
        "invalid_state",
        "The managed write repository cannot change within a run.",
      );
    this.state.timestamp(input.recordedAt);
    const loaded = await prepareContextDocuments({
      ...input,
      coordinates: this.options.coordinates,
      policyVersion: this.options.policyVersion,
    });
    assertLoadedContextIntegrity(loaded);
    assertPreparedBinding(loaded, this.options);
    const snapshot = copy(loaded);
    this.append(preparedContextEventSpecs(snapshot));
    this.state.setPrepared(
      snapshot,
      input.repositoryRoot,
      input.role.capabilities["filesystem.write"],
      normalizeExpectedWritePaths(input.expectedPaths),
      input.writeRepositoryRoot,
    );
    return copy(snapshot);
  }

  async injectContext(input: ManagedInjectContextInput): Promise<InjectedContext> {
    const snapshot = snapshotInjectInput(input);
    return this.runExclusive("inject_context", () => this.injectContextOnce(snapshot));
  }

  private async injectContextOnce(input: ManagedInjectContextInput): Promise<InjectedContext> {
    this.state.assertPhase("context_prepared");
    const loaded = this.state.loadedSnapshot();
    const repositoryRoot = this.state.repositoryRoot;
    if (loaded === undefined || repositoryRoot === undefined) {
      throw new ManagedContextError("invalid_state", "There is no prepared context to inject.");
    }
    const injected = await injectLoadedContext({
      ...input,
      repositoryRoot,
      loaded,
      contextGeneration: this.state.generation,
      getCurrentContextGeneration: () => this.state.generation,
    });
    if (this.state.phase !== "context_prepared") {
      throw new ManagedContextError(
        "invalid_state",
        "The generation was invalidated during context injection.",
      );
    }
    this.append([injectedContextEventSpec(injected)]);
    this.state.setInjected(injected);
    return copy(injected);
  }

  private invalidateAll(reason: ManagedContextInvalidationReason, occurredAt: string): void {
    this.append([
      runtimeInvalidationEventSpec({
        documentIds: this.state.requiredDocumentIds,
        reason,
        occurredAt,
        contextGeneration: this.state.generation,
      }),
    ]);
    this.state.invalidate(occurredAt);
  }

  invalidateContext(reason: "context_compacted" | "session_restarted", occurredAt: Date): void {
    this.state.assertOperational();
    if (this.state.requiredDocumentIds.length === 0) {
      throw new ManagedContextError("invalid_state", "There is no managed context to invalidate.");
    }
    this.invalidateAll(reason, this.state.timestamp(occurredAt));
  }

  handleAdapterEvent(
    session: AdapterSession,
    event: AdapterNormalizedEvent,
    recordedAt: Date,
  ): boolean {
    this.state.assertOperational();
    const reason = adapterInvalidationReason({
      coordinates: this.options.coordinates,
      session: copy(session),
      event: copy(event),
      injectedProviderSessionId: this.state.injectedProviderSessionId,
    });
    if (
      reason === null ||
      this.state.phase === "awaiting_context" ||
      this.state.requiredDocumentIds.length === 0
    ) {
      return false;
    }
    this.invalidateAll(reason, this.state.timestamp(new Date(recordedAt.getTime())));
    return true;
  }

  async authorizeFileWrite(input: FileWriteRequest): Promise<ManagedWriteDecision> {
    const snapshot = copy(input);
    return this.runExclusive("authorize_file_write", () => this.writes.authorize(snapshot));
  }

  async recordFileChange(input: FileChangeRecord): Promise<ManagedFileChangeEvidence> {
    return this.runExclusive("record_file_change", () => this.writes.recordChange(copy(input)));
  }
}

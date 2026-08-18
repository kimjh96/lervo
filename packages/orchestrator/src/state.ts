import type { LoadedContext } from "@lervo/context";
import type { InjectedContext } from "@lervo/context-delivery";
import {
  evaluateWriteContext,
  type RequiredContextDocument,
  type WriteContextDecision,
} from "@lervo/core";
import type { CapabilityDecision, ContextEvidence } from "@lervo/schemas";

import {
  type FileWritePermit,
  ManagedContextError,
  type ManagedContextPhase,
  type ManagedContextSnapshot,
  type ManagedRunCoordinates,
} from "./types.js";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class ManagedContextState {
  private phaseValue: ManagedContextPhase = "awaiting_context";
  private generationValue: number;
  private loadedValue: LoadedContext | undefined;
  private repositoryRootValue: string | undefined;
  private evidence: ContextEvidence[] = [];
  private requiredDocumentsValue: RequiredContextDocument[] = [];
  private activePermit: FileWritePermit | undefined;
  private injectedProviderValue: string | undefined;
  private injectedProviderSessionIdValue: string | undefined;
  private writePolicyValue: CapabilityDecision | undefined;
  private expectedPathsValue: string[] = [];
  private lastEventAt = Number.NEGATIVE_INFINITY;

  constructor(initialGeneration: number) {
    this.generationValue = initialGeneration;
  }

  get phase(): ManagedContextPhase {
    return this.phaseValue;
  }

  get generation(): number {
    return this.generationValue;
  }

  get repositoryRoot(): string | undefined {
    return this.repositoryRootValue;
  }

  get injectedProvider(): string | undefined {
    return this.injectedProviderValue;
  }

  get injectedProviderSessionId(): string | undefined {
    return this.injectedProviderSessionIdValue;
  }

  get writePolicy(): CapabilityDecision | undefined {
    return this.writePolicyValue;
  }

  get requiredDocumentIds(): string[] {
    return this.requiredDocumentsValue.map((document) => document.documentId);
  }

  expectsPath(path: string): boolean {
    return this.expectedPathsValue.includes(path);
  }

  loadedSnapshot(): LoadedContext | undefined {
    return this.loadedValue === undefined ? undefined : copy(this.loadedValue);
  }

  snapshot(): ManagedContextSnapshot {
    return {
      phase: this.phaseValue,
      contextGeneration: this.generationValue,
      telemetryHealthy: this.phaseValue !== "telemetry_failed",
      requiredDocumentIds: this.requiredDocumentIds,
    };
  }

  assertOperational(): void {
    if (this.phaseValue === "telemetry_failed") {
      throw new ManagedContextError(
        "telemetry_recording_failed",
        "Telemetry 복구 전에는 managed context 실행을 계속할 수 없습니다.",
      );
    }
  }

  assertPhase(expected: ManagedContextPhase): void {
    this.assertOperational();
    if (this.phaseValue !== expected) {
      throw new ManagedContextError(
        "invalid_state",
        `${expected} 상태에서만 수행할 수 있는 작업입니다.`,
      );
    }
  }

  timestamp(date: Date): string {
    if (!Number.isFinite(date.getTime()) || date.getTime() < this.lastEventAt) {
      throw new ManagedContextError(
        "context_contract_invalid",
        "Managed run event 시각은 유효하고 이전 event보다 빠르지 않아야 합니다.",
      );
    }
    return date.toISOString();
  }

  observeEvent(occurredAt: string): void {
    this.lastEventAt = Date.parse(occurredAt);
  }

  failTelemetry(): never {
    this.phaseValue = "telemetry_failed";
    this.generationValue += 1;
    this.activePermit = undefined;
    throw new ManagedContextError(
      "telemetry_recording_failed",
      "필수 telemetry 기록에 실패해 변경 capability를 닫았습니다.",
    );
  }

  setPrepared(
    loaded: LoadedContext,
    repositoryRoot: string,
    writePolicy: CapabilityDecision,
    expectedPaths: readonly string[],
  ): void {
    const snapshot = copy(loaded);
    this.loadedValue = snapshot;
    this.repositoryRootValue = repositoryRoot;
    this.evidence = [...copy(snapshot.evidence)];
    this.requiredDocumentsValue = snapshot.documents
      .filter((document) => document.required)
      .map((document) => ({
        documentId: document.documentId,
        contentHash: document.contentHash,
        scope: copy(document.scope),
      }));
    this.activePermit = undefined;
    this.injectedProviderValue = undefined;
    this.injectedProviderSessionIdValue = undefined;
    this.writePolicyValue = writePolicy;
    this.expectedPathsValue = [...expectedPaths];
    this.phaseValue = "context_prepared";
    this.observeEvent(snapshot.loadedAt);
  }

  setInjected(injected: InjectedContext): void {
    this.evidence = [...copy(injected.evidence)];
    this.injectedProviderValue = injected.receipt.provider;
    this.injectedProviderSessionIdValue = injected.receipt.providerSessionId;
    this.phaseValue = "context_injected";
    this.observeEvent(injected.receipt.acceptedAt);
  }

  invalidate(occurredAt: string): void {
    this.generationValue += 1;
    this.activePermit = undefined;
    this.phaseValue = "awaiting_context";
    this.observeEvent(occurredAt);
  }

  evaluateWriteContext(coordinates: ManagedRunCoordinates): WriteContextDecision {
    if (this.requiredDocumentsValue.length === 0) {
      return {
        allowed: false,
        assurance: null,
        failure: "required_context_missing",
        missing: [],
      };
    }
    return evaluateWriteContext({
      coordinates: {
        projectId: coordinates.projectId,
        runId: coordinates.runId,
        sessionId: coordinates.sessionId,
        contextGeneration: this.generationValue,
      },
      requiredDocuments: this.requiredDocumentsValue,
      evidence: this.evidence,
    });
  }

  issuePermit(input: {
    permitId: string;
    path: string;
    targetDigest: string;
    expectedBeforeHash: string | null;
    authorizedAt: string;
  }): FileWritePermit {
    const permit = {
      ...input,
      contextGeneration: this.generationValue,
    };
    this.activePermit = permit;
    this.phaseValue = "write_authorized";
    this.observeEvent(input.authorizedAt);
    return copy(permit);
  }

  assertPermit(permit: FileWritePermit): void {
    if (
      this.activePermit === undefined ||
      permit.permitId !== this.activePermit.permitId ||
      permit.contextGeneration !== this.generationValue ||
      permit.path !== this.activePermit.path ||
      permit.expectedBeforeHash !== this.activePermit.expectedBeforeHash ||
      permit.targetDigest !== this.activePermit.targetDigest
    ) {
      throw new ManagedContextError(
        "write_permit_invalid",
        "현재 generation에 발급한 파일 쓰기 permit가 아닙니다.",
      );
    }
  }
}

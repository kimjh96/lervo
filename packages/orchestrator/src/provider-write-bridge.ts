import {
  createManagedWriteDecision,
  inspectManagedWriteCompletionBinding,
  inspectManagedWriteRequestBinding,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteDecision,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
  SharedContextPublication,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { readManagedFileHash } from "./file-snapshot.js";
import { ManagedContextRun } from "./managed-context-run.js";
import type { ManagedWritePlan } from "./managed-write-plan.js";
import { ManagedProviderRunError } from "./provider-run-types.js";
import {
  type FileWritePermit,
  ManagedContextError,
  type ManagedFileChangeEvidence,
} from "./types.js";

interface ApprovedWrite {
  request: AdapterManagedWriteRequest;
  decision: AdapterManagedWriteDecision;
  permit: FileWritePermit;
}

function assertAdapterMessage(value: unknown, label: string): void {
  if (!validateSchema("adapter", value).valid) {
    throw writeError(
      "contract_validation_failed",
      `${label}이 adapter 계약을 통과하지 못했습니다.`,
    );
  }
}

function writeError(
  code: ConstructorParameters<typeof ManagedProviderRunError>[0],
  message: string,
  options?: ErrorOptions & { paths?: readonly string[] },
): ManagedProviderRunError {
  return new ManagedProviderRunError(code, message, {
    ...options,
    originPhase: "provider_write",
  });
}

function wrapWriteFailure(error: unknown): ManagedProviderRunError {
  if (error instanceof ManagedProviderRunError) {
    return error.originPhase === undefined
      ? writeError(error.code, error.message, {
          cause: error.cause,
          paths: error.paths,
        })
      : error;
  }
  if (error instanceof ManagedContextError && error.code === "telemetry_recording_failed") {
    return writeError(
      "telemetry_recording_failed",
      "Managed write telemetry 기록에 실패했습니다.",
      { cause: error },
    );
  }
  return writeError(
    "provider_write_failed",
    "Managed write 정책 또는 파일 검증 단계가 실패했습니다.",
    { cause: error instanceof Error ? error : undefined },
  );
}

function changeKind(
  beforeHash: string | null,
  afterHash: string | null,
): ManagedFileChangeEvidence["changeKind"] | null {
  if (beforeHash === null && afterHash !== null) return "created";
  if (beforeHash !== null && afterHash === null) return "deleted";
  if (beforeHash !== null && afterHash !== null && beforeHash !== afterHash) return "modified";
  return null;
}

export class ManagedProviderWriteBridge implements ProviderManagedWriteBridge {
  private readonly approvals = new Map<string, ApprovedWrite>();
  private readonly completed: ManagedFileChangeEvidence[] = [];

  constructor(
    private readonly options: {
      session: AdapterSession;
      currentTurn: () => AdapterTurn | undefined;
      context: ManagedContextRun;
      plan: ManagedWritePlan;
      repositoryRoot: string;
      risk: string;
      publications: readonly SharedContextPublication[];
      now: () => Date;
    },
  ) {}

  async authorize(
    request: AdapterManagedWriteRequest,
  ): Promise<AdapterManagedWriteDecision> {
    assertAdapterMessage(request, "Managed write request");
    const turn = this.options.currentTurn();
    if (turn === undefined) {
      throw writeError(
        "contract_validation_failed",
        "Turn 수락 전에 managed write를 요청할 수 없습니다.",
      );
    }
    const binding = inspectManagedWriteRequestBinding({
      session: this.options.session,
      turn,
      request,
    });
    if (
      !binding.passed ||
      !this.options.plan.allowedPaths.includes(request.path) ||
      this.approvals.has(request.providerItemId) ||
      this.completed.length >= this.options.plan.maximumVerifiedChanges
    ) {
      throw writeError(
        "contract_validation_failed",
        "Managed write 요청 좌표가 현재 turn과 다르거나 중복되었습니다.",
      );
    }
    let decision;
    try {
      decision = await this.options.context.authorizeFileWrite({
        path: request.path,
        targetDigest: request.targetDigest,
        risk: this.options.risk,
        publications: this.options.publications,
        occurredAt: this.date(),
      });
    } catch (error) {
      throw wrapWriteFailure(error);
    }
    const result = createManagedWriteDecision({
      request,
      decision: decision.allowed ? "allow" : "deny",
      reasonCode: decision.allowed ? "authorized" : decision.failure,
      decidedAt: this.time(),
    });
    assertAdapterMessage(result, "Managed write decision");
    if (decision.allowed) {
      this.approvals.set(request.providerItemId, {
        request: structuredClone(request),
        decision: structuredClone(result),
        permit: structuredClone(decision.permit),
      });
    }
    return structuredClone(result);
  }

  async complete(completion: AdapterManagedWriteCompletion): Promise<void> {
    assertAdapterMessage(completion, "Managed write completion");
    const approved = this.approvals.get(completion.providerItemId);
    if (approved === undefined) {
      throw writeError(
        "contract_validation_failed",
        "승인되지 않은 managed write 완료 보고를 받았습니다.",
      );
    }
    const binding = inspectManagedWriteCompletionBinding({
      request: approved.request,
      decision: approved.decision,
      completion,
    });
    if (!binding.passed) {
      throw writeError(
        "contract_validation_failed",
        "Managed write 완료 보고가 승인 좌표와 다릅니다.",
      );
    }
    if (completion.status !== "completed") {
      throw writeError(
        "provider_write_failed",
        "승인된 provider 파일 변경이 완료되지 않았습니다.",
      );
    }
    const afterHash = await readManagedFileHash(
      this.options.repositoryRoot,
      approved.request.path,
    );
    const observedKind = changeKind(approved.permit.expectedBeforeHash, afterHash);
    if (
      observedKind === null ||
      (approved.request.changeKind !== "upsert" &&
        observedKind !== approved.request.changeKind)
    ) {
      throw writeError(
        "provider_write_failed",
        "Provider가 승인된 종류와 다른 파일 상태를 만들었습니다.",
      );
    }
    let evidence;
    try {
      evidence = await this.options.context.recordFileChange({
        permit: approved.permit,
        path: approved.request.path,
        beforeHash: approved.permit.expectedBeforeHash,
        afterHash,
        changeKind: observedKind,
        occurredAt: this.date(),
      });
    } catch (error) {
      throw wrapWriteFailure(error);
    }
    this.approvals.delete(completion.providerItemId);
    this.completed.push(structuredClone(evidence));
  }

  assertSettled(): void {
    if (
      this.approvals.size > 0 ||
      this.completed.length < this.options.plan.minimumVerifiedChanges ||
      this.completed.length > this.options.plan.maximumVerifiedChanges
    ) {
      throw writeError(
        "provider_write_failed",
        "Managed write run의 검증된 변경 수가 실행 계획과 다릅니다.",
      );
    }
  }

  evidence(): ManagedFileChangeEvidence[] {
    return structuredClone(this.completed);
  }

  private date(): Date {
    const value = this.options.now();
    if (!Number.isFinite(value.getTime())) {
      throw writeError(
        "contract_validation_failed",
        "Managed write bridge 시각이 유효하지 않습니다.",
      );
    }
    return new Date(value.getTime());
  }

  private time(): string {
    return this.date().toISOString();
  }
}

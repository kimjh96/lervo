import { validateContextSnapshot } from "@lervo/context";

import {
  fileChangedEventSpec,
  invalidationEventSpecs,
  runtimeInvalidationEventSpec,
  writeCapabilityEventSpecs,
} from "./event-specs.js";
import { readManagedFileHash } from "./file-snapshot.js";
import { ManagedContextState } from "./state.js";
import type { ManagedEventSpec } from "./telemetry.js";
import {
  type FileChangeRecord,
  type FileWriteRequest,
  ManagedContextError,
  type ManagedContextInvalidationReason,
  type ManagedCapabilityApprovalVerifier,
  type ManagedFileChangeEvidence,
  type ManagedRunCoordinates,
  type ManagedWriteDecision,
} from "./types.js";
import { validateFileChange, validateWriteRequest } from "./validation.js";

type AppendEvents = (specs: readonly ManagedEventSpec[]) => { eventId: string }[];
type InvalidateContext = (
  reason: ManagedContextInvalidationReason,
  occurredAt: string,
) => void;

export class ManagedWriteController {
  constructor(
    private readonly state: ManagedContextState,
    private readonly coordinates: ManagedRunCoordinates,
    private readonly append: AppendEvents,
    private readonly invalidateAll: InvalidateContext,
    private readonly approvalVerifier?: ManagedCapabilityApprovalVerifier,
  ) {}

  private telemetryFailureDecision(): ManagedWriteDecision {
    return {
      allowed: false,
      assurance: null,
      failure: "telemetry_recording_failed",
      missing: [],
    };
  }

  private async refreshContext(input: FileWriteRequest, occurredAt: string): Promise<void> {
    if (this.state.phase !== "context_injected") return;
    const loaded = this.state.loadedSnapshot();
    const repositoryRoot = this.state.repositoryRoot;
    if (loaded === undefined || repositoryRoot === undefined) {
      throw new ManagedContextError("invalid_state", "검증할 context snapshot이 없습니다.");
    }
    try {
      const freshness = await validateContextSnapshot({
        repositoryRoot,
        loaded,
        publications: input.publications,
        at: input.occurredAt,
      });
      if (!freshness.valid) {
        this.append(
          invalidationEventSpecs({
            invalidations: freshness.invalidations,
            occurredAt,
            contextGeneration: this.state.generation,
          }),
        );
        this.state.invalidate(occurredAt);
      }
    } catch (error) {
      if (error instanceof ManagedContextError) throw error;
      this.invalidateAll("snapshot_validation_failed", occurredAt);
    }
  }

  async authorize(input: FileWriteRequest): Promise<ManagedWriteDecision> {
    if (this.state.phase === "telemetry_failed") return this.telemetryFailureDecision();
    if (this.state.phase === "write_authorized") {
      throw new ManagedContextError(
        "invalid_state",
        "기존 파일 쓰기 permit를 완료하거나 무효화한 뒤 다시 요청해야 합니다.",
      );
    }
    const normalizedPath = validateWriteRequest(input);
    const occurredAt = this.state.timestamp(input.occurredAt);
    await this.refreshContext(input, occurredAt);
    const contextDecision = this.state.expectsPath(normalizedPath)
      ? this.state.evaluateWriteContext(this.coordinates)
      : {
          allowed: false as const,
          assurance: null,
          failure: "required_context_missing" as const,
          missing: [],
        };
    const writePolicy = this.state.writePolicy;
    let approval:
      | { approvalId: string; policySnapshotId: string }
      | undefined;
    let capabilityDecision: "allow" | "deny" | "require_approval";
    if (writePolicy === "deny") {
      capabilityDecision = "deny" as const;
    } else if (writePolicy === "require_approval") {
      capabilityDecision = "require_approval" as const;
      if (
        contextDecision.allowed &&
        input.approvalAuthorization !== undefined &&
        input.requestDigest !== undefined &&
        input.verificationSuiteIds !== undefined &&
        this.approvalVerifier !== undefined &&
        this.state.injectedProvider !== undefined
      ) {
        let result;
        try {
          result = await this.approvalVerifier.verify({
            authorization: input.approvalAuthorization,
            ...this.coordinates,
            provider: this.state.injectedProvider,
            risk: input.risk,
            requestDigest: input.requestDigest,
            verificationSuiteIds: [...input.verificationSuiteIds],
            expectedPaths: this.state.expectedPaths,
            requestedPath: normalizedPath,
            evaluatedAt: occurredAt,
          });
        } catch {
          throw new ManagedContextError(
            "approval_verification_failed",
            "파일 쓰기 직전 approval 원본 재검증에 실패했습니다.",
          );
        }
        if (result.approved) {
          if (
            result.policySnapshotId !== input.approvalAuthorization.policySnapshotId ||
            !input.approvalAuthorization.approvalIds.includes(result.approvalId)
          ) {
            throw new ManagedContextError(
              "approval_verification_failed",
              "Approval verifier 결과가 현재 authorization 좌표와 다릅니다.",
            );
          }
          capabilityDecision = "allow";
          approval = result;
        }
      }
    } else {
      capabilityDecision = contextDecision.allowed ? "allow" as const : "deny" as const;
    }
    let expectedBeforeHash: string | null = null;
    if (capabilityDecision === "allow") {
      const repositoryRoot = this.state.repositoryRoot;
      if (repositoryRoot === undefined) {
        throw new ManagedContextError(
          "invalid_state",
          "변경 대상 파일을 검증할 repository root가 없습니다.",
        );
      }
      expectedBeforeHash = await readManagedFileHash(repositoryRoot, normalizedPath);
    }
    let events;
    try {
      events = this.append(
        writeCapabilityEventSpecs({
          targetDigest: input.targetDigest,
          risk: input.risk,
          occurredAt,
          decision: capabilityDecision,
          approvalId: approval?.approvalId ?? null,
          policyRuleId: approval === undefined
            ? "managed_context_e3"
            : "managed_context_e3+signed_approval",
        }),
      );
    } catch (error) {
      if (error instanceof ManagedContextError && error.code === "telemetry_recording_failed") {
        return this.telemetryFailureDecision();
      }
      throw error;
    }
    if (
      writePolicy === "deny" ||
      (writePolicy === "require_approval" && approval === undefined)
    ) {
      this.state.observeEvent(occurredAt);
      return {
        allowed: false,
        assurance: contextDecision.assurance,
        failure: capabilityDecision === "deny" ? "capability_denied" : "approval_required",
        missing: [],
      };
    }
    if (!contextDecision.allowed) {
      this.state.observeEvent(occurredAt);
      return contextDecision;
    }
    if (contextDecision.assurance !== "E3") {
      throw new ManagedContextError(
        "invalid_state",
        "필수 E3 문서가 없는 실행에는 파일 쓰기 permit를 발급할 수 없습니다.",
      );
    }
    const permit = this.state.issuePermit({
      permitId: events[1]!.eventId,
      path: normalizedPath,
      targetDigest: input.targetDigest,
      expectedBeforeHash,
      authorizedAt: occurredAt,
      approvalId: approval?.approvalId ?? null,
      policySnapshotId: approval?.policySnapshotId ?? null,
    });
    return { allowed: true, assurance: "E3", missing: [], permit };
  }

  async recordChange(input: FileChangeRecord): Promise<ManagedFileChangeEvidence> {
    this.state.assertPhase("write_authorized");
    this.state.assertPermit(input.permit);
    const provider = this.state.injectedProvider;
    const repositoryRoot = this.state.repositoryRoot;
    if (provider === undefined || repositoryRoot === undefined) {
      throw new ManagedContextError(
        "invalid_state",
        "파일 변경 주체나 repository root가 없습니다.",
      );
    }
    const occurredAt = this.state.timestamp(input.occurredAt);
    const normalizedPath = validateFileChange(input);
    if (normalizedPath !== input.permit.path) {
      throw new ManagedContextError(
        "write_permit_invalid",
        "파일 쓰기 permit의 대상 경로와 실제 변경 경로가 다릅니다.",
      );
    }
    let actualAfterHash: string | null;
    try {
      actualAfterHash = await readManagedFileHash(repositoryRoot, normalizedPath);
    } catch (error) {
      this.invalidateAll("file_change_unverified", occurredAt);
      throw error;
    }
    this.state.assertPhase("write_authorized");
    this.state.assertPermit(input.permit);
    if (
      input.beforeHash !== input.permit.expectedBeforeHash ||
      input.afterHash !== actualAfterHash
    ) {
      this.invalidateAll("file_change_unverified", occurredAt);
      throw new ManagedContextError(
        "file_snapshot_invalid",
        "파일 변경 hash가 permit 또는 현재 저장소 상태와 다릅니다.",
      );
    }
    this.append([
      fileChangedEventSpec({ ...input, normalizedPath, provider }),
      runtimeInvalidationEventSpec({
        documentIds: this.state.requiredDocumentIds,
        reason: "managed_file_changed",
        occurredAt,
        contextGeneration: this.state.generation,
      }),
    ]);
    this.state.invalidate(occurredAt);
    return {
      path: normalizedPath,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      changeKind: input.changeKind,
    };
  }
}

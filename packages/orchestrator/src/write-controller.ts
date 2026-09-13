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
type InvalidateContext = (reason: ManagedContextInvalidationReason, occurredAt: string) => void;

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
      throw new ManagedContextError("invalid_state", "There is no context snapshot to verify.");
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
        "Complete or invalidate the existing file-write permit before requesting another one.",
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
    let approval: { approvalId: string; policySnapshotId: string } | undefined;
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
            "Failed to revalidate the approval source immediately before the file write.",
          );
        }
        if (result.approved) {
          if (
            result.policySnapshotId !== input.approvalAuthorization.policySnapshotId ||
            !input.approvalAuthorization.approvalIds.includes(result.approvalId)
          ) {
            throw new ManagedContextError(
              "approval_verification_failed",
              "The approval verifier result differs from the current authorization coordinates.",
            );
          }
          capabilityDecision = "allow";
          approval = result;
        }
      }
    } else {
      capabilityDecision = contextDecision.allowed ? ("allow" as const) : ("deny" as const);
    }
    let expectedBeforeHash: string | null = null;
    if (capabilityDecision === "allow") {
      const repositoryRoot = this.state.writeRepositoryRoot;
      if (repositoryRoot === undefined) {
        throw new ManagedContextError(
          "invalid_state",
          "There is no repository root for validating the target file.",
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
          policyRuleId:
            approval === undefined ? "managed_context_e3" : "managed_context_e3+signed_approval",
        }),
      );
    } catch (error) {
      if (error instanceof ManagedContextError && error.code === "telemetry_recording_failed") {
        return this.telemetryFailureDecision();
      }
      throw error;
    }
    if (writePolicy === "deny" || (writePolicy === "require_approval" && approval === undefined)) {
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
        "A file-write permit cannot be issued for a run without the required E3 documents.",
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
    const repositoryRoot = this.state.writeRepositoryRoot;
    if (provider === undefined || repositoryRoot === undefined) {
      throw new ManagedContextError(
        "invalid_state",
        "The file-change actor or repository root is missing.",
      );
    }
    const occurredAt = this.state.timestamp(input.occurredAt);
    const normalizedPath = validateFileChange(input);
    if (normalizedPath !== input.permit.path) {
      throw new ManagedContextError(
        "write_permit_invalid",
        "The file-write permit target path differs from the actual change path.",
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
        "The file-change hash differs from the permit or current repository state.",
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

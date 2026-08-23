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
  ManagedRunApprovalAuthorization,
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
      `${label} does not satisfy the adapter contract.`,
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
      "Failed to record managed write telemetry.",
      { cause: error },
    );
  }
  return writeError(
    "provider_write_failed",
    "The managed write policy or file validation stage failed.",
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
  private activeExpectedPath: string | undefined;
  private completedBeforeTurn = 0;

  constructor(
    private readonly options: {
      session: AdapterSession;
      currentTurn: () => AdapterTurn | undefined;
      context: ManagedContextRun;
      plan: ManagedWritePlan;
      repositoryRoot: string;
      risk: string;
      requestDigest: string;
      verificationSuiteIds: readonly string[];
      approvalAuthorization?: ManagedRunApprovalAuthorization;
      publications: readonly SharedContextPublication[];
      now: () => Date;
    },
  ) {}

  beginTurn(expectedPath: string): void {
    if (
      this.activeExpectedPath !== undefined || this.approvals.size > 0 ||
      !this.options.plan.allowedPaths.includes(expectedPath) ||
      this.completed.some((change) => change.path === expectedPath)
    ) {
      throw writeError(
        "contract_validation_failed",
        "The managed write turn expected path differs from the execution plan.",
      );
    }
    this.activeExpectedPath = expectedPath;
    this.completedBeforeTurn = this.completed.length;
  }

  async authorize(
    request: AdapterManagedWriteRequest,
  ): Promise<AdapterManagedWriteDecision> {
    assertAdapterMessage(request, "Managed write request");
    const turn = this.options.currentTurn();
    if (turn === undefined) {
      throw writeError(
        "contract_validation_failed",
        "A managed write cannot be requested before turn acceptance.",
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
      request.path !== this.activeExpectedPath ||
      this.approvals.has(request.providerItemId) ||
      this.completed.some((change) => change.path === request.path) ||
      this.completed.length >= this.options.plan.maximumVerifiedChanges
    ) {
      throw writeError(
        "contract_validation_failed",
        "The managed write request coordinates differ from the current turn or are duplicated.",
      );
    }
    let decision;
    try {
      decision = await this.options.context.authorizeFileWrite({
        path: request.path,
        targetDigest: request.targetDigest,
        risk: this.options.risk,
        requestDigest: this.options.requestDigest,
        verificationSuiteIds: this.options.verificationSuiteIds,
        ...(this.options.approvalAuthorization === undefined
          ? {}
          : { approvalAuthorization: this.options.approvalAuthorization }),
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
        "Received an unapproved managed write completion report.",
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
        "The managed write completion report differs from the approval coordinates.",
      );
    }
    if (completion.status !== "completed") {
      throw writeError(
        "provider_write_failed",
        "The approved provider file change was not completed.",
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
        "The provider created a file state different from the approved kind.",
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

  assertTurnSettled(expectedPath: string): void {
    const changes = this.completed.slice(this.completedBeforeTurn);
    if (
      this.activeExpectedPath !== expectedPath || this.approvals.size > 0 ||
      changes.length !== this.options.plan.pathsPerTurn || changes[0]?.path !== expectedPath
    ) {
      throw writeError(
        "provider_write_failed",
        "The managed write turn did not complete its single expected path as a verified change.",
      );
    }
    this.activeExpectedPath = undefined;
    this.completedBeforeTurn = this.completed.length;
  }

  assertSettled(): void {
    if (
      this.approvals.size > 0 || this.activeExpectedPath !== undefined ||
      this.completed.length < this.options.plan.minimumVerifiedChanges ||
      this.completed.length > this.options.plan.maximumVerifiedChanges
    ) {
      throw writeError(
        "provider_write_failed",
        "The managed write run verified-change count differs from the execution plan.",
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
        "The managed write bridge time is invalid.",
      );
    }
    return new Date(value.getTime());
  }

  private time(): string {
    return this.date().toISOString();
  }
}

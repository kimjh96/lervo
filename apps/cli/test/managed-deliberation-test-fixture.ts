import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createAdapterTurnResult,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import { defaultEnglishWritingContract } from "@lervo/core";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterTurn,
  AdapterTurnRequest,
  AdapterTurnResult,
} from "@lervo/schemas";

import type { RunProvider } from "../src/managed-run.js";

const roots: string[] = [];

export function semanticPass(): string {
  return JSON.stringify({
    checks: defaultEnglishWritingContract.verification.semanticChecks.map((check) => ({
      checkId: check.checkId,
      status: "passed",
      violationCount: 0,
    })),
  });
}

export class FixtureDeliberationAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;
  private turn?: AdapterTurn;
  private release?: () => void;
  private readonly started = new Promise<void>((resolveStarted) => {
    this.release = resolveStarted;
  });

  constructor(
    private readonly provider: RunProvider,
    private readonly providerSessionId: string,
    private readonly content: string,
    private readonly receiptId: string,
  ) {
    this.descriptor = {
      kind: "descriptor",
      schemaVersion: 1,
      adapterId: `lervo/${provider}`,
      adapterVersion: "fixture-1",
      provider,
      capabilities: {
        controlledContextInjection: "supported",
        toolCalls: "unsupported",
        commandExecution: "unsupported",
        fileChanges: "unsupported",
        contextCompaction: "unsupported",
        sessionResume: "unsupported",
        usage: "unknown",
      },
    };
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    return {
      kind: "session",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId: request.writingPolicyId,
      provider: this.provider,
      providerSessionId: this.providerSessionId,
      executionMode: request.executionMode,
      effectiveCapabilities: this.descriptor.capabilities,
      startedAt: request.requestedAt,
    };
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    return {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: this.receiptId,
      envelopeId: envelope.envelopeId,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      roleId: session.roleId,
      writingPolicyId: session.writingPolicyId,
      writingPolicyDocumentId: envelope.writingPolicyDocumentId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      targetTurnId: envelope.targetTurnId,
      contextGeneration: envelope.contextGeneration,
      controlledInput: true,
      documents: envelope.documents.map((document) => ({
        documentId: document.documentId,
        contentHash: document.contentHash,
        scope: document.scope,
        status: "injected" as const,
      })),
      acceptedAt: envelope.createdAt,
    };
  }

  async attachManagedWriteBridge(
    _session: AdapterSession,
    _bridge: ProviderManagedWriteBridge,
  ): Promise<void> {}

  async startTurn(
    _session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: (turn: AdapterTurn) => void,
  ): Promise<AdapterTurn> {
    this.turn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: request.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: `provider-${request.targetTurnId}`,
      acceptedAt: request.requestedAt,
    };
    accepted(structuredClone(this.turn));
    this.release?.();
    return structuredClone(this.turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    await Promise.race([
      this.started,
      new Promise<void>((resolveAbort) =>
        signal.addEventListener("abort", () => resolveAbort(), { once: true })),
    ]);
    if (signal.aborted || this.turn === undefined) return;
    yield {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: `evt_provider_${this.receiptId.slice(4)}`,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type: "provider.turn.completed",
      occurredAt: this.turn.acceptedAt,
      payload: {
        providerTurnId: this.turn.providerTurnId,
        status: "completed",
        durationMs: 1,
      },
    };
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    return createAdapterTurnResult({
      session,
      turn,
      content: this.content,
      producedAt: turn.acceptedAt,
    });
  }

  async stop(session: AdapterSession, request: AdapterStopRequest) {
    return {
      kind: "stop_result" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: request.requestedAt,
    };
  }
}


export function sequence() {
  let value = 0;
  return (prefix: string) => `${prefix}_${String(++value).padStart(16, "0")}`;
}

export function clock() {
  let value = Date.parse("2026-08-21T00:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

export async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-deliberation-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({
    root,
    projectId: "prj_cli_deliberation",
    now: new Date("2026-08-21T00:00:00Z"),
  }));
  await mkdir(resolve(root, "src"));
  await mkdir(resolve(root, ".lervo/verifications"));
  await writeFile(
    resolve(root, "AGENTS.md"),
    "Check repository evidence and answer in a natural English paragraph.\n",
  );
  await writeFile(
    resolve(root, ".lervo/verifications/project.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: project.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-project",
      "    executable: node",
      "    arguments:",
      "      - -e",
      "      - process.exit(0)",
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  return root;
}

export async function writeFourRolePolicy(root: string): Promise<void> {
  await mkdir(resolve(root, ".lervo/deliberations"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/deliberations/deliberation_product-review.yaml"),
    [
      "schemaVersion: 1",
      "policyId: deliberation_product-review",
      "maxRounds: 2",
      "requiredVerificationSuiteIds:",
      "  - project.default",
      "participants:",
      "  - roleId: product-planner",
      "    name: Product planner",
      "    description: Writes proposals centered on user value and scope.",
      "    provider: codex",
      "    responsibilities: [proposer, decision_owner]",
      "  - roleId: maintainability-reviewer",
      "    name: Maintenance reviewer",
      "    description: Independently reviews separation of concerns and long-term change cost.",
      "    provider: claude",
      "    responsibilities: [reviewer]",
      "  - roleId: evidence-reviewer",
      "    name: Evidence reviewer",
      "    description: Independently reviews whether claims are sufficiently linked to repository evidence.",
      "    provider: codex",
      "    responsibilities: [reviewer]",
      "  - roleId: project-verifier",
      "    name: Project verifier",
      "    description: Checks actual verification results and the scope of conclusions.",
      "    provider: claude",
      "    responsibilities: [verifier]",
      "",
    ].join("\n"),
  );
}

export async function cleanupManagedDeliberationFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

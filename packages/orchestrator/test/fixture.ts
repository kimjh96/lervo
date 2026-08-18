import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@roven/event-store-sqlite";
import type { ContextArtifactPort, ContextArtifactPutResult } from "@roven/context-delivery";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterSession,
  DocumentRegistry,
  RoleProfile,
} from "@roven/schemas";

import {
  ManagedContextRun,
  type ManagedEventStore,
} from "../src/index.js";

export const projectId = "prj_orchestrator_01";
export const runId = "run_orchestrator_01";
export const sessionId = "ses_orchestrator_01";
export const policyVersion =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const targetDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const temporaryRoots: string[] = [];

export function hash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export class MemoryArtifactStore implements ContextArtifactPort {
  readonly objects = new Map<string, Uint8Array>();

  async put(content: Uint8Array): Promise<ContextArtifactPutResult> {
    const bytes = new Uint8Array(content);
    const contentHash = hash(bytes);
    const uri = `roven-cas://sha256/${contentHash.slice(7)}`;
    this.objects.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength };
  }

  async get(uri: string): Promise<Uint8Array> {
    const bytes = this.objects.get(uri);
    if (bytes === undefined) throw new Error("fixture artifact not found");
    return new Uint8Array(bytes);
  }
}

export function sequenceFactory(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(8, "0")}`;
}

export const role: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description: "저장소 코드를 변경합니다.",
  requestTypes: ["implementation"],
  requiredInputs: [],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "allow",
    "shell.execute": "allow",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "source_code",
    schemaRef: "roven-schema://fixture/source-code/v1",
    pathTemplate: "src/{runId}.ts",
    citationsRequired: false,
    presentation: { audience: "machine", writingPolicyId: null },
  },
  verification: { suiteIds: ["test.fixture"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: [],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export interface ManagedFixture {
  root: string;
  store: SQLiteEventStore;
  session: AdapterSession;
  createRun(events?: ManagedEventStore): ManagedContextRun;
}

export async function createManagedFixture(): Promise<ManagedFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-orchestrator-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, ".roven/state"), { recursive: true });
  await mkdir(resolve(root, "src"), { recursive: true });
  await writeFile(resolve(root, "AGENTS.md"), "저장소 작업 지침입니다.\n");
  const store = await SQLiteEventStore.open({
    path: resolve(root, ".roven/state", "events.sqlite"),
    projectId,
  });
  const session: AdapterSession = {
    kind: "session",
    schemaVersion: 1,
    adapterId: "roven/fixture",
    projectId,
    runId,
    sessionId,
    roleId: role.roleId,
    writingPolicyId: null,
    provider: "fixture",
    providerSessionId: "provider-session-1",
    executionMode: "read_only",
    effectiveCapabilities: {
      controlledContextInjection: "supported",
      toolCalls: "supported",
      commandExecution: "unsupported",
      fileChanges: "unsupported",
      contextCompaction: "unknown",
      sessionResume: "unsupported",
      usage: "unknown",
    },
    startedAt: "2026-08-18T01:00:00Z",
  };
  return {
    root,
    store,
    session,
    createRun: (events = store) =>
      new ManagedContextRun({
        coordinates: { projectId, runId, sessionId, roleId: role.roleId },
        policyVersion,
        events,
        createEventId: sequenceFactory("evt_orchestrator"),
      }),
  };
}

export function providerRunInput() {
  const registry: DocumentRegistry = { schemaVersion: 1, documents: {} };
  return {
    requestDigest: targetDigest,
    risk: "low",
    instructions: "저장소를 읽고 결과를 설명합니다.",
    targetTurnId: "turn-managed-provider-1",
    context: {
      registry,
      role: {
        ...role,
        capabilities: { ...role.capabilities, "filesystem.write": "deny" as const },
      },
      expectedPaths: ["src/result.ts"],
      documentRules: {},
      publications: [],
      handoffs: [],
      createReceiptId: sequenceFactory("ctx_selected"),
    },
    writingPolicy: null,
    resolvedSkills: [],
    createEnvelopeId: () => "envelope-provider-run-1",
    createEvidenceReceiptId: sequenceFactory("ctx_injected"),
  };
}

export async function prepareFixtureContext(
  run: ManagedContextRun,
  root: string,
  fixtureRole: RoleProfile = role,
) {
  const registry: DocumentRegistry = { schemaVersion: 1, documents: {} };
  return run.prepareContext({
    repositoryRoot: root,
    sourceRevision: "working-tree:fixture-1",
    registry,
    role: fixtureRole,
    expectedPaths: ["src/result.ts"],
    documentRules: {},
    publications: [],
    handoffs: [],
    recordedAt: new Date("2026-08-18T01:01:00Z"),
    createReceiptId: sequenceFactory("ctx_orchestrator"),
  });
}

export function receiptFor(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
): AdapterContextReceipt {
  return {
    kind: "context_receipt",
    schemaVersion: 1,
    receiptId: "ctx_adapter_orchestrator",
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
    acceptedAt: "2026-08-18T01:03:00Z",
  };
}

export async function injectFixtureContext(
  run: ManagedContextRun,
  session: AdapterSession,
) {
  return run.injectContext({
    session,
    writingPolicy: null,
    targetTurnId: "turn-orchestrator-1",
    publications: [],
    injectContext: async (adapterSession, envelope) =>
      receiptFor(adapterSession, envelope),
    now: () => new Date("2026-08-18T01:02:00Z"),
    createEnvelopeId: () => "envelope-orchestrator-1",
    createEvidenceReceiptId: sequenceFactory("ctx_injected"),
  });
}

export function failOnEventType(
  store: SQLiteEventStore,
  eventType: string,
): ManagedEventStore {
  return {
    transact: (work) =>
      store.transact((transaction) =>
        work({
          append: (draft) => {
            if (draft.type === eventType) throw new Error("fixture telemetry failure");
            return transaction.append(draft);
          },
        }),
      ),
  };
}

export async function cleanupManagedFixtures(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { prepareContext, type LoadedContext } from "@lervo/context";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterSession,
  DocumentRegistry,
  RoleProfile,
} from "@lervo/schemas";

import type {
  ContextArtifactPort,
  ContextArtifactPutResult,
  ResolvedWritingPolicy,
} from "../src/index.js";
import { writingPolicyFixture } from "./fixture-writing-policy.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const writingPolicyDocumentId = "doc_writing_policy";
const temporaryRoots: string[] = [];

export function receiptFactory(prefix = "ctx_evidence"): () => string {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(8, "0")}`;
}

export function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export class MemoryArtifactStore implements ContextArtifactPort {
  readonly objects = new Map<string, Uint8Array>();

  async put(content: Uint8Array): Promise<ContextArtifactPutResult> {
    const bytes = Buffer.from(content);
    const contentHash = hash(bytes);
    const uri = `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
    this.objects.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength };
  }

  async get(uri: string): Promise<Uint8Array> {
    const bytes = this.objects.get(uri);
    if (bytes === undefined) throw new Error("missing fixture object");
    return Buffer.from(bytes);
  }
}

export interface DeliveryFixture {
  repositoryRoot: string;
  loaded: LoadedContext;
  session: AdapterSession;
  writingPolicy: ResolvedWritingPolicy;
}

export async function createDeliveryFixture(): Promise<DeliveryFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-context-delivery-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "docs"), { recursive: true });
  await writeFile(resolve(root, "AGENTS.md"), "Repository work instructions.\n");
  await writeFile(
    resolve(root, "docs/writing.json"),
    `${JSON.stringify(writingPolicyFixture, null, 2)}\n`,
  );
  const registry: DocumentRegistry = {
    schemaVersion: 1,
    documents: {
      [writingPolicyDocumentId]: {
        path: "docs/writing.json",
        kind: "canonical",
        responsibleParty: { kind: "team", id: "team_content" },
        connectedPaths: ["outputs/**"],
        verifiedRevision: "fixture-v1",
        verifiedAt: "2026-08-18T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      },
    },
  };
  const role: RoleProfile = {
    schemaVersion: 1,
    roleId: "writer",
    name: "Writer",
    description: "Writes human-readable prose.",
    requestTypes: ["writing"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "allow",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "human_text",
      schemaRef: "lervo-schema://fixture/human-text/v1",
      pathTemplate: "outputs/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: "writing_en-human",
      },
    },
    verification: { suiteIds: ["writing.fixture"], failureDisposition: "fail_run" },
    handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
  };
  const loaded = await prepareContext({
    repositoryRoot: root,
    sourceRevision: "working-tree:fixture-v1",
    coordinates: {
      projectId,
      runId: "run_delivery_01",
      sessionId: "ses_delivery_01",
      roleId: role.roleId,
    },
    registry,
    role,
    expectedPaths: ["outputs/result.md"],
    documentRules: { "writing.policy": [writingPolicyDocumentId] },
    publications: [],
    handoffs: [],
    policyVersion,
    recordedAt: new Date("2026-08-18T01:01:00Z"),
    createReceiptId: receiptFactory(),
  });
  const session: AdapterSession = {
    kind: "session",
    schemaVersion: 1,
    adapterId: "lervo/fixture",
    projectId,
    runId: "run_delivery_01",
    sessionId: "ses_delivery_01",
    roleId: role.roleId,
    writingPolicyId: "writing_en-human",
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
  const policyDocument = loaded.documents.find(
    (document) => document.documentId === writingPolicyDocumentId,
  )!;
  return {
    repositoryRoot: root,
    loaded,
    session,
    writingPolicy: {
      writingPolicyId: session.writingPolicyId!,
      documentId: policyDocument.documentId,
      contentHash: policyDocument.contentHash,
    },
  };
}

export function receiptFor(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
  overrides: Partial<AdapterContextReceipt> = {},
): AdapterContextReceipt {
  return {
    kind: "context_receipt",
    schemaVersion: 1,
    receiptId: "ctx_adapter_01234567",
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
      documentRole: document.documentRole,
      referenceEligible: document.referenceEligible,
      status: "injected" as const,
    })),
    acceptedAt: "2026-08-18T01:03:00Z",
    ...overrides,
  };
}

export async function cleanupDeliveryFixtures(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { prepareContext, type LoadedContext } from "@roven/context";
import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterSession,
  type DocumentRegistry,
  type RoleProfile,
} from "@roven/schemas";
import type { ArtifactPutResult, ArtifactStore } from "@roven/storage-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildContextEnvelope,
  ContextDeliveryError,
  injectLoadedContext,
  verifyContextReceipt,
} from "../src/index.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const writingPolicyDocumentId = "doc_writing_policy";
const temporaryRoots: string[] = [];

function receiptFactory(prefix = "ctx_evidence"): () => string {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(8, "0")}`;
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(content: string | Uint8Array): Promise<ArtifactPutResult> {
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const contentHash = hash(bytes);
    const uri = `roven-cas://sha256/${contentHash.slice("sha256:".length)}`;
    const created = !this.objects.has(uri);
    this.objects.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength, created };
  }

  async putStream(chunks: AsyncIterable<string | Uint8Array>): Promise<ArtifactPutResult> {
    const buffers: Buffer[] = [];
    for await (const chunk of chunks) {
      buffers.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return this.put(Buffer.concat(buffers));
  }

  async get(uri: string): Promise<Uint8Array> {
    const bytes = this.objects.get(uri);
    if (bytes === undefined) throw new Error("missing fixture object");
    return Buffer.from(bytes);
  }

  async has(uri: string): Promise<boolean> {
    return this.objects.has(uri);
  }
}

interface Fixture {
  repositoryRoot: string;
  loaded: LoadedContext;
  session: AdapterSession;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-context-delivery-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "docs"), { recursive: true });
  await writeFile(resolve(root, "AGENTS.md"), "저장소 작업 지침입니다.\n");
  await writeFile(
    resolve(root, "docs/writing.md"),
    "한국 사람이 일상에서 쓰는 자연스러운 문단으로 작성합니다.\n",
  );
  const registry: DocumentRegistry = {
    schemaVersion: 1,
    documents: {
      [writingPolicyDocumentId]: {
        path: "docs/writing.md",
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
    description: "사람이 읽는 글을 작성합니다.",
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
      schemaRef: "roven-schema://fixture/human-text/v1",
      pathTemplate: "outputs/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: "writing_ko-kr-human",
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
    adapterId: "roven/fixture",
    projectId,
    runId: "run_delivery_01",
    sessionId: "ses_delivery_01",
    roleId: role.roleId,
    writingPolicyId: "writing_ko-kr-human",
    provider: "fixture",
    providerSessionId: "provider-session-1",
    startedAt: "2026-08-18T01:00:00Z",
  };
  return { repositoryRoot: root, loaded, session };
}

function receiptFor(
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
      status: "injected" as const,
    })),
    acceptedAt: "2026-08-18T01:03:00Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("provider-neutral context delivery", () => {
  it("creates E3 only after an exact controlled receipt including the writing policy", async () => {
    const currentGeneration = 2;
    const input = await fixture();
    const injected = await injectLoadedContext({
      ...input,
      publications: [],
      writingPolicyDocumentId,
      targetTurnId: "turn-1",
      contextGeneration: currentGeneration,
      getCurrentContextGeneration: () => currentGeneration,
      injectContext: async (session, envelope) => receiptFor(session, envelope),
      now: () => new Date("2026-08-18T01:02:00Z"),
      createEnvelopeId: () => "envelope-1",
      createEvidenceReceiptId: receiptFactory("ctx_e3"),
    });

    expect(injected.envelope.documents.every((document) => document.delivery.kind === "inline"))
      .toBe(true);
    expect(injected.envelope.documents.map((document) => document.documentId)).toContain(
      writingPolicyDocumentId,
    );
    expect(injected.e3Evidence).toHaveLength(input.loaded.documents.length);
    expect(injected.e3Evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "injected",
          documentId: writingPolicyDocumentId,
          adapterReceiptId: "ctx_adapter_01234567",
          contextGeneration: currentGeneration,
        }),
      ]),
    );
    expect(injected.evidence.slice(0, input.loaded.evidence.length)).toEqual(
      input.loaded.evidence,
    );
  });

  it("moves documents to verified CAS objects when inline delivery is too small", async () => {
    const input = await fixture();
    const store = new MemoryArtifactStore();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicyDocumentId,
      targetTurnId: "turn-cas",
      contextGeneration: 0,
      createdAt: new Date("2026-08-18T01:02:00Z"),
      deliveryMode: "auto",
      inlineByteLimit: 0,
      artifactStore: store,
      createEnvelopeId: () => "envelope-cas",
    });

    expect(envelope.documents.every((document) => document.delivery.kind === "cas")).toBe(true);
    expect(store.objects.size).toBe(input.loaded.documents.length);
    for (const document of envelope.documents) {
      if (document.delivery.kind !== "cas") throw new Error("expected CAS delivery");
      expect(hash(await store.get(document.delivery.uri))).toBe(document.contentHash);
    }
  });

  it("rejects a CAS backend that cannot return the exact stored bytes", async () => {
    class CorruptingStore extends MemoryArtifactStore {
      override async get(_uri: string): Promise<Uint8Array> {
        return Buffer.from("different bytes");
      }
    }
    const input = await fixture();

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicyDocumentId,
        targetTurnId: "turn-missing-cas",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
        deliveryMode: "cas",
      }),
    ).rejects.toMatchObject({
      code: "artifact_store_required",
      failure: "artifact_storage_failed",
    });

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicyDocumentId,
        targetTurnId: "turn-corrupt-cas",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
        deliveryMode: "cas",
        artifactStore: new CorruptingStore(),
      }),
    ).rejects.toMatchObject({
      code: "artifact_storage_failed",
      failure: "artifact_storage_failed",
    });
  });

  it("does not call the adapter when a loaded file changed before injection", async () => {
    const input = await fixture();
    await writeFile(
      resolve(input.repositoryRoot, "docs/writing.md"),
      "주입 전에 바뀐 정책입니다.\n",
    );
    let called = false;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        writingPolicyDocumentId,
        targetTurnId: "turn-changed",
        contextGeneration: 1,
        getCurrentContextGeneration: () => 1,
        injectContext: async () => {
          called = true;
          throw new Error("must not be called");
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({
      code: "context_snapshot_invalid",
      failure: "required_context_missing",
    });
    expect(called).toBe(false);
  });

  it.each([
    ["another session", { sessionId: "ses_other_01" }, "context_receipt_mismatch"],
    ["another document hash", {}, "context_receipt_mismatch"],
  ] as const)("rejects a receipt for %s", async (_label, overrides, expectedCode) => {
    const input = await fixture();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicyDocumentId,
      targetTurnId: "turn-invalid",
      contextGeneration: 3,
      createdAt: new Date("2026-08-18T01:02:00Z"),
    });
    const receipt = receiptFor(input.session, envelope, overrides);
    if (Object.keys(overrides).length === 0) {
      receipt.documents[0] = {
        ...receipt.documents[0]!,
        contentHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };
    }

    expect(() =>
      verifyContextReceipt({
        envelope,
        session: input.session,
        receipt,
        expectedContextGeneration: 3,
      }),
    ).toThrowError(expect.objectContaining<Partial<ContextDeliveryError>>({ code: expectedCode }));
  });

  it("rejects a receipt that omits a document or changes its scope", async () => {
    const input = await fixture();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicyDocumentId,
      targetTurnId: "turn-document-set",
      contextGeneration: 3,
      createdAt: new Date("2026-08-18T01:02:00Z"),
    });
    const missing = receiptFor(input.session, envelope);
    missing.documents = missing.documents.slice(1);
    const changedScope = receiptFor(input.session, envelope);
    changedScope.documents[0] = {
      ...changedScope.documents[0]!,
      scope: { kind: "sections", sections: ["different"] },
    };

    for (const receipt of [missing, changedScope]) {
      expect(() =>
        verifyContextReceipt({
          envelope,
          session: input.session,
          receipt,
          expectedContextGeneration: 3,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ContextDeliveryError>>({
          code: "context_receipt_mismatch",
        }),
      );
    }
  });

  it("rejects E3 when compaction changes generation during adapter injection", async () => {
    const input = await fixture();
    let generation = 4;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        writingPolicyDocumentId,
        targetTurnId: "turn-compacted",
        contextGeneration: generation,
        getCurrentContextGeneration: () => generation,
        injectContext: async (session, envelope) => {
          generation += 1;
          return receiptFor(session, envelope);
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({
      code: "stale_context_generation",
      failure: "required_context_missing",
    });
  });

  it("rejects altered E2 bytes and a session missing its writing policy document", async () => {
    const input = await fixture();
    const altered: LoadedContext = {
      ...input.loaded,
      documents: input.loaded.documents.map((document, index) =>
        index === 0 ? { ...document, bytes: Buffer.from("altered") } : document,
      ),
    };
    await expect(
      buildContextEnvelope({
        loaded: altered,
        session: input.session,
        writingPolicyDocumentId,
        targetTurnId: "turn-altered",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_loaded_context" });

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicyDocumentId: null,
        targetTurnId: "turn-no-policy",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({ code: "writing_policy_document_missing" });
  });
});

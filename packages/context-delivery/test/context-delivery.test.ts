import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { LoadedContext } from "@lervo/context";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildContextEnvelope,
  casContextDelivery,
  ContextDeliveryError,
  createInlineThresholdPolicy,
  injectLoadedContext,
  verifyContextReceipt,
} from "../src/index.js";
import {
  cleanupDeliveryFixtures,
  createDeliveryFixture,
  hash,
  MemoryArtifactStore,
  receiptFactory,
  receiptFor,
  writingPolicyDocumentId,
} from "./fixture.js";

afterEach(cleanupDeliveryFixtures);

describe("provider-neutral context delivery", () => {
  it("preserves knowledge assurance and freshness in the controlled envelope and E3 evidence", async () => {
    const input = await createDeliveryFixture();
    const documentId = input.loaded.documents[0]!.documentId;
    const knowledgeContext = {
      conceptId: "concept_aaaaaaaaaaaaaaaaaaaaaaaa",
      assurance: "human_reviewed" as const,
      freshness: "stale" as const,
      sourceSnapshotId: "ksnap_bbbbbbbbbbbbbbbbbbbbbbbb",
      impactReportId: "kimpact_cccccccccccccccccccccccc",
    };
    const loaded: LoadedContext = structuredClone(input.loaded);
    for (const document of loaded.plan.documents) {
      if (document.documentId === documentId) document.knowledgeContext = knowledgeContext;
    }
    for (const document of loaded.documents) {
      if (document.documentId === documentId) document.knowledgeContext = knowledgeContext;
    }
    for (const evidence of [...loaded.plan.evidence, ...loaded.evidence]) {
      if (evidence.documentId === documentId) evidence.knowledgeContext = knowledgeContext;
    }
    const injected = await injectLoadedContext({
      ...input,
      loaded,
      publications: [],
      targetTurnId: "turn-knowledge",
      contextGeneration: 1,
      getCurrentContextGeneration: () => 1,
      injectContext: async (session, envelope) => receiptFor(session, envelope),
      now: () => new Date("2026-08-18T01:02:00Z"),
    });

    expect(injected.envelope.documents.find((item) => item.documentId === documentId)?.knowledgeContext)
      .toEqual(knowledgeContext);
    expect(injected.e3Evidence.find((item) => item.documentId === documentId)?.knowledgeContext)
      .toEqual(knowledgeContext);
  });

  it("creates E3 only after an exact controlled receipt including the writing policy", async () => {
    const currentGeneration = 2;
    const input = await createDeliveryFixture();
    const injected = await injectLoadedContext({
      ...input,
      publications: [],
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
    for (const evidence of injected.e3Evidence) {
      const envelopeDocument = injected.envelope.documents.find(
        (document) => document.documentId === evidence.documentId,
      )!;
      const loadedDocument = input.loaded.documents.find(
        (document) => document.documentId === evidence.documentId,
      )!;
      expect(envelopeDocument.scope).not.toBe(loadedDocument.scope);
      expect(evidence.scope).not.toBe(envelopeDocument.scope);
    }
  });

  it("moves documents to verified CAS objects when inline delivery is too small", async () => {
    const input = await createDeliveryFixture();
    const store = new MemoryArtifactStore();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicy: input.writingPolicy,
      targetTurnId: "turn-cas",
      contextGeneration: 0,
      createdAt: new Date("2026-08-18T01:02:00Z"),
      deliveryPolicy: createInlineThresholdPolicy(0),
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

  it("uses the real filesystem CAS through the narrow artifact port", async () => {
    const input = await createDeliveryFixture();
    const store = await FileSystemCas.open(resolve(input.repositoryRoot, ".cas-test"));
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicy: input.writingPolicy,
      targetTurnId: "turn-real-cas",
      contextGeneration: 0,
      createdAt: new Date("2026-08-18T01:02:00Z"),
      deliveryPolicy: casContextDelivery,
      artifactStore: store,
    });

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
    const input = await createDeliveryFixture();

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicy: input.writingPolicy,
        targetTurnId: "turn-missing-cas",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
        deliveryPolicy: casContextDelivery,
      }),
    ).rejects.toMatchObject({
      code: "artifact_store_required",
      failure: "artifact_storage_failed",
    });

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicy: input.writingPolicy,
        targetTurnId: "turn-corrupt-cas",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
        deliveryPolicy: casContextDelivery,
        artifactStore: new CorruptingStore(),
      }),
    ).rejects.toMatchObject({
      code: "artifact_storage_failed",
      failure: "artifact_storage_failed",
    });
  });

  it("does not call the adapter when a loaded file changed before injection", async () => {
    const input = await createDeliveryFixture();
    await writeFile(
      resolve(input.repositoryRoot, "docs/writing.json"),
      "Policy changed before injection.\n",
    );
    let called = false;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
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

  it("binds the writing policy ID to a schema-valid document and exact hash", async () => {
    const input = await createDeliveryFixture();
    const wrongDocument = input.loaded.documents.find(
      (document) => document.documentId !== writingPolicyDocumentId,
    )!;

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicy: {
          writingPolicyId: input.session.writingPolicyId!,
          documentId: wrongDocument.documentId,
          contentHash: wrongDocument.contentHash,
        },
        targetTurnId: "turn-wrong-policy",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({
      code: "writing_policy_document_invalid",
      failure: "contract_validation_failed",
    });
  });

  it("rejects an envelope timestamp older than its E2 snapshot", async () => {
    const input = await createDeliveryFixture();

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicy: input.writingPolicy,
        targetTurnId: "turn-backdated",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:00:30Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_delivery_request" });
  });

  it("does not create E3 evidence when the adapter call fails", async () => {
    const input = await createDeliveryFixture();
    let evidenceIdsCreated = 0;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        targetTurnId: "turn-adapter-failure",
        contextGeneration: 0,
        getCurrentContextGeneration: () => 0,
        injectContext: async () => {
          throw new Error("provider payload must not escape");
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
        createEvidenceReceiptId: () => {
          evidenceIdsCreated += 1;
          return `ctx_failed_${evidenceIdsCreated}`;
        },
      }),
    ).rejects.toMatchObject({ code: "injection_failed" });
    expect(evidenceIdsCreated).toBe(0);
  });

  it("maps E3 receipt ID factory failures to the public delivery error contract", async () => {
    const input = await createDeliveryFixture();

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        targetTurnId: "turn-evidence-id-failure",
        contextGeneration: 0,
        getCurrentContextGeneration: () => 0,
        injectContext: async (session, envelope) => receiptFor(session, envelope),
        now: () => new Date("2026-08-18T01:02:00Z"),
        createEvidenceReceiptId: () => {
          throw new Error("internal ID provider detail");
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_context_evidence" });
  });

  it("does not create E3 when a source file changes during adapter injection", async () => {
    const input = await createDeliveryFixture();
    let evidenceIdsCreated = 0;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        targetTurnId: "turn-racing-change",
        contextGeneration: 0,
        getCurrentContextGeneration: () => 0,
        injectContext: async (session, envelope) => {
          await writeFile(
            resolve(input.repositoryRoot, "docs/writing.json"),
            `${JSON.stringify({ changed: true })}\n`,
          );
          return receiptFor(session, envelope);
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
        createEvidenceReceiptId: () => {
          evidenceIdsCreated += 1;
          return `ctx_racing_${evidenceIdsCreated}`;
        },
      }),
    ).rejects.toMatchObject({ code: "context_snapshot_invalid" });
    expect(evidenceIdsCreated).toBe(0);
  });

  it("rejects an adapter that mutates the controlled envelope before issuing a receipt", async () => {
    const input = await createDeliveryFixture();
    const originalSession = structuredClone(input.session);

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
        targetTurnId: "turn-mutating-adapter",
        contextGeneration: 0,
        getCurrentContextGeneration: () => 0,
        injectContext: async (session, envelope) => {
          session.roleId = "mutated-role";
          envelope.documents[0] = {
            ...envelope.documents[0]!,
            contentHash:
              "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          };
          return receiptFor(session, envelope);
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({ code: "context_receipt_mismatch" });
    expect(input.session).toEqual(originalSession);
  });

  it.each([
    ["another session", { sessionId: "ses_other_01" }, "context_receipt_mismatch"],
    ["another document hash", {}, "context_receipt_mismatch"],
  ] as const)("rejects a receipt for %s", async (_label, overrides, expectedCode) => {
    const input = await createDeliveryFixture();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicy: input.writingPolicy,
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
    const input = await createDeliveryFixture();
    const envelope = await buildContextEnvelope({
      loaded: input.loaded,
      session: input.session,
      writingPolicy: input.writingPolicy,
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
    const input = await createDeliveryFixture();
    let generation = 4;

    await expect(
      injectLoadedContext({
        ...input,
        publications: [],
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
    const input = await createDeliveryFixture();
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
        writingPolicy: input.writingPolicy,
        targetTurnId: "turn-altered",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_loaded_context" });

    await expect(
      buildContextEnvelope({
        loaded: input.loaded,
        session: input.session,
        writingPolicy: null,
        targetTurnId: "turn-no-policy",
        contextGeneration: 0,
        createdAt: new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toMatchObject({ code: "writing_policy_document_missing" });
  });
});

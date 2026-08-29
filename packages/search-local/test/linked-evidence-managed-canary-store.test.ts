import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { managedLinkedEvidenceSelectionProtocolDigest } from "@lervo/context";
import { canonicalJson } from "@lervo/event-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedLinkedEvidenceCanaryRecord,
  assertManagedLinkedEvidenceCanaryRecord,
  LINKED_EVIDENCE_MANAGED_CANARY_MAX_RECORDS,
  LocalManagedLinkedEvidenceCanaryStore,
} from "../src/index.js";

const roots: string[] = [];
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local managed linked-evidence canary store", () => {
  it("continues to validate preserved schema-v1 provider-turn records", () => {
    const core = {
      schemaVersion: 1 as const,
      canaryId: "canary_fixture_01",
      projectId: "prj_fixture_01",
      runId: "run_fixture_legacy",
      providerArm: "codex" as const,
      policy: { id: "linked-evidence-managed-canary-v1" as const, version: 1 as const },
      protocol: {
        id: "linked-evidence-provider-shadow-relational-coverage-v17" as const,
        digest: managedLinkedEvidenceSelectionProtocolDigest,
      },
      sourceSnapshotId: hash("1"),
      recommendationBatchId: "srb_fixture_01",
      selectionAttemptId: `lsel_${"2".repeat(24)}`,
      adapterReceiptId: "receipt_fixture_01",
      contextDeliveryId: "receipt_delivery_01",
      candidateCount: 1,
      selectedCount: 1,
      loadedCount: 1,
      injectedCount: 1,
      referencedCount: 0,
      candidateDigest: hash("3"),
      selectedDigest: hash("4"),
      loadedDigest: hash("4"),
      injectedDigest: hash("4"),
      referencedDigest: hash("5"),
      providerVisibleBytes: 40,
      selectedBytes: 40,
      loadedBytes: 40,
      injectedBytes: 40,
      durationMs: 12,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 2,
        reasoningOutputTokens: 1,
        totalTokens: 12,
      },
      status: "completed" as const,
      failureCode: null,
      recordedAt: "2026-08-29T00:00:00.000Z",
    };
    const digest = createHash("sha256").update(canonicalJson(core)).digest("hex");
    expect(() =>
      assertManagedLinkedEvidenceCanaryRecord({
        recordId: `lcanary_${digest.slice(0, 24)}`,
        ...core,
      }),
    ).not.toThrow();
  });

  it("writes one immutable owner-only privacy-bounded record", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-linked-canary-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    const store = await LocalManagedLinkedEvidenceCanaryStore.open(root);
    const record = createManagedLinkedEvidenceCanaryRecord({
      canaryId: "canary_fixture_01",
      projectId: "prj_fixture_01",
      runId: "run_fixture_01",
      providerArm: "codex",
      sourceSnapshotId: hash("1"),
      recommendationBatchId: "srb_fixture_01",
      selectionAttemptId: `lsel_${"2".repeat(24)}`,
      selectionPolicy: {
        kind: "provider_turn",
        policyId: "linked-evidence-provider-shadow-relational-coverage-v17",
        policyDigest: managedLinkedEvidenceSelectionProtocolDigest,
      },
      adapterReceiptId: "receipt_fixture_01",
      contextDeliveryId: "receipt_delivery_01",
      candidateCount: 2,
      selectedCount: 1,
      loadedCount: 1,
      injectedCount: 1,
      referencedCount: 0,
      candidateDigest: hash("3"),
      selectedDigest: hash("4"),
      loadedDigest: hash("4"),
      injectedDigest: hash("4"),
      referencedDigest: hash("5"),
      candidateBytes: 100,
      selectionProviderVisibleBytes: 100,
      selectedBytes: 40,
      loadedBytes: 40,
      injectedBytes: 40,
      durationMs: 12,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 2,
        reasoningOutputTokens: 1,
        totalTokens: 12,
      },
      status: "completed",
      failureCode: null,
      recordedAt: "2026-08-29T00:00:00.000Z",
    });

    await store.record(record);
    await store.record(record);
    expect(await store.list()).toEqual([record]);
    expect(LINKED_EVIDENCE_MANAGED_CANARY_MAX_RECORDS).toBe(128);
    const target = resolve(
      root,
      ".lervo/state/search/linked-evidence-managed-canary",
      `${record.recordId}.json`,
    );
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(target, "utf8");
    for (const forbidden of ["path", "prompt", "query", "body", "title", "link", "result"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });

  it("rejects a conflicting replay for the same run", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-linked-canary-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    const store = await LocalManagedLinkedEvidenceCanaryStore.open(root);
    const base = {
      canaryId: "canary_fixture_01",
      projectId: "prj_fixture_01",
      runId: "run_fixture_01",
      providerArm: "claude" as const,
      sourceSnapshotId: hash("1"),
      recommendationBatchId: "srb_fixture_01",
      selectionAttemptId: `lsel_${"2".repeat(24)}`,
      selectionPolicy: {
        kind: "provider_turn" as const,
        policyId: "linked-evidence-provider-shadow-relational-coverage-v17" as const,
        policyDigest: managedLinkedEvidenceSelectionProtocolDigest,
      },
      adapterReceiptId: null,
      contextDeliveryId: null,
      candidateCount: 2,
      selectedCount: 0,
      loadedCount: 0,
      injectedCount: 0,
      referencedCount: 0,
      candidateDigest: hash("3"),
      selectedDigest: hash("4"),
      loadedDigest: hash("4"),
      injectedDigest: hash("4"),
      referencedDigest: hash("4"),
      candidateBytes: 100,
      selectionProviderVisibleBytes: 100,
      selectedBytes: 0,
      loadedBytes: 0,
      injectedBytes: 0,
      durationMs: 1,
      usage: null,
      status: "failed" as const,
      failureCode: "canary_selection_invalid" as const,
      recordedAt: "2026-08-29T00:00:00.000Z",
    };
    await store.record(createManagedLinkedEvidenceCanaryRecord(base));
    await expect(
      store.record(
        createManagedLinkedEvidenceCanaryRecord({
          ...base,
          failureCode: "canary_selection_unavailable",
        }),
      ),
    ).rejects.toMatchObject({ code: "observation_conflict" });
  });
});

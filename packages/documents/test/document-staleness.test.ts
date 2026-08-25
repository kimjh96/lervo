import { describe, expect, it } from "vitest";

import { calculateDocumentStalenessResultId, evaluateDocumentStaleness } from "../src/index.js";
import {
  generatedManifest,
  HASH_A,
  HASH_B,
  HASH_C,
  HASH_D,
  managedManifest,
  snapshot,
  userManifest,
} from "./document-staleness-fixture.js";

describe("document staleness detector", () => {
  it("returns a deterministic current result at the verified revision", () => {
    const manifest = userManifest();
    const current = snapshot("snapshot:verified");

    const result = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T09:00:00+09:00",
      currentSnapshot: current,
    });

    expect(result).toEqual({
      schemaVersion: 1,
      resultId: result.resultId,
      documentId: manifest.documentId,
      evaluatedAt: "2026-08-19T00:00:00.000Z",
      status: "current",
      verifiedRevision: "snapshot:verified",
      currentRevision: "snapshot:verified",
      signals: {
        reviewInterval: { status: "current", dueAt: "2026-08-31T00:00:00.000Z" },
        documentPath: { status: "current" },
        connectedPaths: { status: "current", changedPaths: [], unobservedPaths: [] },
        managedInputs: {
          status: "not_applicable",
          changedSourceIds: [],
          missingSourceIds: [],
          unobservedSourceIds: [],
        },
      },
      reasons: [],
    });
    expect(calculateDocumentStalenessResultId(result)).toBe(result.resultId);
    expect(
      evaluateDocumentStaleness({
        manifest,
        evaluatedAt: "2026-08-19T00:00:00Z",
        currentSnapshot: current,
      }),
    ).toEqual(result);
  });

  it("marks the review interval stale at the exact due instant", () => {
    const result = evaluateDocumentStaleness({
      manifest: userManifest(),
      evaluatedAt: "2026-08-31T00:00:00Z",
      currentSnapshot: snapshot("snapshot:verified"),
    });

    expect(result.status).toBe("stale");
    expect(result.signals.reviewInterval.status).toBe("stale");
    expect(result.reasons).toContain("review_interval_elapsed");
  });

  it("does not call a missing document or unobserved scope current at the verified revision", () => {
    const result = evaluateDocumentStaleness({
      manifest: userManifest({ connectedPaths: ["missing-scope"] }),
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: snapshot("snapshot:verified", {}),
    });

    expect(result.status).toBe("stale");
    expect(result.signals.documentPath.status).toBe("stale");
    expect(result.signals.connectedPaths).toEqual({
      status: "unknown",
      changedPaths: [],
      unobservedPaths: ["missing-scope"],
    });
    expect(result.reasons).toEqual(["connected_path_unobserved", "document_path_missing"]);
  });

  it("uses a matching verified snapshot to detect document and connected path changes", () => {
    const manifest = userManifest({ connectedPaths: ["src", "config/tool.json"] });
    const verified = snapshot("snapshot:verified", {
      "README.md": HASH_A,
      "src/index.ts": HASH_B,
      "config/tool.json": HASH_C,
    });
    const current = snapshot("snapshot:current", {
      "README.md": HASH_D,
      "src/index.ts": HASH_B,
      "src/new.ts": HASH_C,
      "config/tool.json": HASH_C,
      "src2/unrelated.ts": HASH_D,
    });

    const result = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: current,
      verifiedSnapshot: verified,
    });

    expect(result.status).toBe("stale");
    expect(result.signals.documentPath.status).toBe("stale");
    expect(result.signals.connectedPaths).toEqual({
      status: "stale",
      changedPaths: ["src/new.ts"],
      unobservedPaths: [],
    });
    expect(result.reasons).toEqual(["connected_path_changed", "document_path_changed"]);
  });

  it.each([
    ["AGENTS.md", "doc_agents_000001"],
    ["CLAUDE.md", "doc_claude_000001"],
    ["README.md", "doc_readme_000001"],
  ])("detects a stale %s fixture", (path, documentId) => {
    const manifest = userManifest({ documentId, path });
    const verifiedFiles = { [path]: HASH_A, "src/index.ts": HASH_B };
    const currentFiles = { [path]: HASH_C, "src/index.ts": HASH_B };

    const result = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: snapshot("snapshot:current", currentFiles),
      verifiedSnapshot: snapshot("snapshot:verified", verifiedFiles),
    });

    expect(result.status).toBe("stale");
    expect(result.signals.documentPath.status).toBe("stale");
    expect(result.reasons).toContain("document_path_changed");
  });

  it("keeps revision evidence unknown when the verified snapshot is absent or mismatched", () => {
    const input = {
      manifest: userManifest(),
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: snapshot("snapshot:current"),
    };
    const absent = evaluateDocumentStaleness(input);
    expect(absent).toMatchObject({
      status: "unknown",
      signals: {
        documentPath: { status: "unknown" },
        connectedPaths: { status: "unknown" },
      },
      reasons: ["verified_snapshot_unavailable"],
    });

    const mismatched = evaluateDocumentStaleness({
      ...input,
      verifiedSnapshot: snapshot("snapshot:other"),
    });
    expect(mismatched.status).toBe("unknown");
    expect(mismatched.reasons).toEqual(["verified_snapshot_mismatch"]);
  });

  it("reports an unobserved connected scope instead of calling it current", () => {
    const manifest = userManifest({ connectedPaths: ["missing-scope"] });
    const files = { "README.md": HASH_A };
    const result = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: snapshot("snapshot:current", files),
      verifiedSnapshot: snapshot("snapshot:verified", files),
    });

    expect(result.status).toBe("unknown");
    expect(result.signals.connectedPaths).toEqual({
      status: "unknown",
      changedPaths: [],
      unobservedPaths: ["missing-scope"],
    });
    expect(result.reasons).toContain("connected_path_unobserved");
  });

  it("distinguishes current, changed, missing, and unobserved managed inputs", () => {
    const manifest = managedManifest([
      { sourceId: "alpha", contentHash: HASH_A },
      { sourceId: "beta", contentHash: HASH_B },
      { sourceId: "gamma", contentHash: HASH_C },
      { sourceId: "delta", contentHash: HASH_D },
    ]);
    const current = snapshot("snapshot:verified", { "AGENTS.md": HASH_A, "src/index.ts": HASH_B });

    const fullyCurrent = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: current,
      managedInputObservations: [
        { sourceId: "delta", status: "available", contentHash: HASH_D },
        { sourceId: "alpha", status: "available", contentHash: HASH_A },
        { sourceId: "gamma", status: "available", contentHash: HASH_C },
        { sourceId: "beta", status: "available", contentHash: HASH_B },
      ],
    });
    expect(fullyCurrent.status).toBe("current");
    expect(fullyCurrent.signals.managedInputs.status).toBe("current");

    const mixed = evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: current,
      managedInputObservations: [
        { sourceId: "alpha", status: "available", contentHash: HASH_B },
        { sourceId: "beta", status: "missing" },
        { sourceId: "delta", status: "available", contentHash: HASH_D },
      ],
    });
    expect(mixed.status).toBe("stale");
    expect(mixed.signals.managedInputs).toEqual({
      status: "stale",
      changedSourceIds: ["alpha"],
      missingSourceIds: ["beta"],
      unobservedSourceIds: ["gamma"],
    });
    expect(mixed.reasons).toEqual([
      "managed_input_changed",
      "managed_input_missing",
      "managed_input_unobserved",
    ]);
  });

  it("checks generated document inputs with the same hash evidence contract", () => {
    const result = evaluateDocumentStaleness({
      manifest: generatedManifest(),
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot: snapshot("snapshot:verified"),
      managedInputObservations: [
        {
          sourceId: "canonical-policy",
          status: "available",
          contentHash: HASH_B,
        },
      ],
    });

    expect(result.status).toBe("stale");
    expect(result.signals.managedInputs.changedSourceIds).toEqual(["canonical-policy"]);
    expect(result.reasons).toContain("managed_input_changed");
  });

  it.each([
    {
      name: "evaluation before verification",
      input: () => ({
        manifest: userManifest(),
        evaluatedAt: "2026-07-31T23:59:59Z",
        currentSnapshot: snapshot("snapshot:verified"),
      }),
    },
    {
      name: "normalized invalid calendar date",
      input: () => ({
        manifest: userManifest(),
        evaluatedAt: "2026-02-30T00:00:00Z",
        currentSnapshot: snapshot("snapshot:verified"),
      }),
    },
    {
      name: "unsafe snapshot path",
      input: () => ({
        manifest: userManifest(),
        evaluatedAt: "2026-08-19T00:00:00Z",
        currentSnapshot: snapshot("snapshot:verified", { "../outside": HASH_A }),
      }),
    },
    {
      name: "duplicate managed input observation",
      input: () => ({
        manifest: managedManifest(),
        evaluatedAt: "2026-08-19T00:00:00Z",
        currentSnapshot: snapshot("snapshot:verified", { "AGENTS.md": HASH_A }),
        managedInputObservations: [
          { sourceId: "policy", status: "available" as const, contentHash: HASH_A },
          { sourceId: "policy", status: "available" as const, contentHash: HASH_A },
        ],
      }),
    },
    {
      name: "observation not declared by manifest",
      input: () => ({
        manifest: userManifest(),
        evaluatedAt: "2026-08-19T00:00:00Z",
        currentSnapshot: snapshot("snapshot:verified"),
        managedInputObservations: [
          { sourceId: "extra", status: "available" as const, contentHash: HASH_A },
        ],
      }),
    },
    {
      name: "same revision with different file maps",
      input: () => ({
        manifest: userManifest(),
        evaluatedAt: "2026-08-19T00:00:00Z",
        currentSnapshot: snapshot("snapshot:verified", { "README.md": HASH_A }),
        verifiedSnapshot: snapshot("snapshot:verified", { "README.md": HASH_B }),
      }),
    },
  ])("rejects inconsistent evidence: $name", ({ input }) => {
    expect(() => evaluateDocumentStaleness(input())).toThrowError(
      expect.objectContaining({ code: "invalid_staleness_request" }),
    );
  });

  it("does not mutate manifest, snapshots, or observations", () => {
    const manifest = managedManifest();
    const currentSnapshot = snapshot("snapshot:verified", { "AGENTS.md": HASH_A });
    const observations = [
      { sourceId: "policy", status: "available" as const, contentHash: HASH_A },
    ];
    const before = JSON.stringify({ manifest, currentSnapshot, observations });

    evaluateDocumentStaleness({
      manifest,
      evaluatedAt: "2026-08-19T00:00:00Z",
      currentSnapshot,
      managedInputObservations: observations,
    });

    expect(JSON.stringify({ manifest, currentSnapshot, observations })).toBe(before);
  });
});

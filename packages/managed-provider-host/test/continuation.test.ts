import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRemoteDeveloperRole,
  managedProviderContinuationContext,
  verifyManagedProviderContinuation,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(status: "active" | "completed" = "active") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-continuation-"));
  roots.push(root);
  const snapshot = {
    schemaVersion: 1,
    workstreamId: `wks_${"1".repeat(24)}`,
    revision: 9,
    status,
    title: "Continue from Discord",
    objective: "Continue the same verified repository workstream on the remote Node.",
    nextActions: ["Run the requested managed task."],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    origin: {
      kind: "created",
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
    },
    updatedAt: "2026-09-07T09:00:00.000Z",
  } as const;
  const content = `${JSON.stringify(snapshot)}\n`;
  await mkdir(resolve(root, ".lervo/state/workstreams"), { recursive: true });
  await writeFile(resolve(root, ".lervo/state/workstreams/current.json"), content);
  return {
    root,
    coordinate: {
      workstreamId: snapshot.workstreamId,
      revision: snapshot.revision,
      snapshotContentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      assignmentId: `asn_${"2".repeat(24)}`,
      agentId: `agt_${"3".repeat(24)}`,
    },
  };
}

describe("managed provider continuation verification", () => {
  it("prepares the exact workstream as required governance context", () => {
    const prepared = managedProviderContinuationContext(createRemoteDeveloperRole(["repo.check"]));
    expect(prepared.role.contextPolicy.requiredDocumentRuleIds).toContain("repository.workstream");
    expect(prepared.documentRules).toEqual({
      "repository.workstream": [prepared.additionalCandidates[0]!.documentId],
    });
    expect(prepared.additionalCandidates[0]).toMatchObject({
      path: ".lervo/state/workstreams/current.json",
      source: "workstream",
      documentRole: "governance_context",
      referenceEligible: false,
    });
  });

  it("accepts only the exact active local workstream snapshot", async () => {
    const { root, coordinate } = await fixture();

    await expect(
      verifyManagedProviderContinuation({ repositoryRoot: root, continuation: coordinate }),
    ).resolves.toBeUndefined();
    await expect(
      verifyManagedProviderContinuation({
        repositoryRoot: root,
        continuation: { ...coordinate, revision: coordinate.revision + 1 },
      }),
    ).rejects.toMatchObject({ code: "managed_continuation_mismatch" });
  });

  it("rejects a completed workstream", async () => {
    const { root, coordinate } = await fixture("completed");

    await expect(
      verifyManagedProviderContinuation({ repositoryRoot: root, continuation: coordinate }),
    ).rejects.toMatchObject({ code: "managed_continuation_mismatch" });
  });
});

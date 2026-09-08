import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import { afterEach, describe, expect, it } from "vitest";

import { verifyManagedProviderHostCompletion } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function result(changed: boolean): ManagedProviderRunResult {
  return {
    managedChanges: changed ? [{ path: "src/result.ts" }] : [],
  } as unknown as ManagedProviderRunResult;
}

describe("managed provider host completion", () => {
  it("does not impose change lifecycle checks on a read-only result", async () => {
    await expect(
      verifyManagedProviderHostCompletion({
        repositoryRoot: "/not-opened-for-read-only-results",
        continuation: undefined,
        run: result(false),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a changed result when the continued workstream did not advance", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-completion-"));
    roots.push(root);
    const snapshot = {
      schemaVersion: 1,
      workstreamId: `wks_${"1".repeat(24)}`,
      revision: 9,
      status: "active",
      title: "Continue the task",
      objective: "Verify exact managed completion.",
      nextActions: ["Advance the workstream."],
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
      updatedAt: "2026-09-08T00:00:00.000Z",
    } as const;
    const content = `${JSON.stringify(snapshot)}\n`;
    await mkdir(resolve(root, ".lervo/state/workstreams"), { recursive: true });
    await writeFile(resolve(root, ".lervo/state/workstreams/current.json"), content);

    await expect(
      verifyManagedProviderHostCompletion({
        repositoryRoot: root,
        continuation: {
          workstreamId: snapshot.workstreamId,
          revision: snapshot.revision,
          snapshotContentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
          assignmentId: null,
          agentId: null,
        },
        run: result(true),
      }),
    ).rejects.toMatchObject({ code: "managed_completion_invalid" });
  });
});

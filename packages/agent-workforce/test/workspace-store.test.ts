import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspace,
  listWorkspaces,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
  type WorkspaceCoordinationEvent,
} from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const hash = `sha256:${"a".repeat(64)}`;

function record(repositoryInstanceId: string, baseCommit: string): AgentWorkspace {
  return {
    schemaVersion: 1,
    workspaceId: "wsp_0123456789abcdef01234567",
    generation: 1,
    repositoryInstanceId,
    projectId: "prj_workspace_store",
    assignmentId: "asn_0123456789abcdef01234567",
    agentId: "agt_0123456789abcdef01234567",
    leaseGeneration: 1,
    executionKind: "worker",
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit,
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: hash,
    state: "provisioning",
    writerSession: null,
    sealedResult: null,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 1,
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };
}

async function siblingRepository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-store-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_store",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  await writeFile(resolve(root, "tracked.txt"), "base\n");
  await execute("git", ["-C", root, "init"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
  const sibling = await mkdtemp(resolve(tmpdir(), "lervo-workspace-store-sibling-"));
  roots.push(sibling);
  await rm(sibling, { recursive: true });
  await execute("git", ["-C", root, "worktree", "add", "--detach", sibling, "HEAD"]);
  const records = await RepositoryCoordinationRecords.open(root);
  return { root, sibling, baseCommit: stdout.trim(), records };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace coordination store", () => {
  it("persists state and its allowlisted event for sibling worktrees", async () => {
    const fixture = await siblingRepository();
    const workspace = record(fixture.records.home.repositoryInstanceId, fixture.baseCommit);
    await createWorkspace({
      repositoryRoot: fixture.root,
      workspace,
      eventId: "evt_workspace_created_01",
    });
    const fromSibling = await readWorkspace(fixture.sibling, workspace.workspaceId);
    expect(fromSibling?.workspace).toEqual(workspace);

    const ready = await updateWorkspace({
      repositoryRoot: fixture.sibling,
      workspaceId: workspace.workspaceId,
      expectedContentHash: fromSibling!.contentHash,
      eventId: "evt_workspace_ready_0001",
      expectedRevision: 1,
      expectedGeneration: 1,
      nextState: "ready",
      occurredAt: "2026-08-26T00:01:00Z",
      evidence: { hostInspected: true, markerMatched: true, checkoutClean: true },
    });
    expect(ready.workspace).toMatchObject({ state: "ready", revision: 2 });
    expect(await listWorkspaces(fixture.root)).toEqual([ready.workspace]);

    const events = await fixture.records.list<WorkspaceCoordinationEvent>("events");
    expect(events.map((item) => item.value.type)).toEqual([
      "agent.workspace.provisioned",
      "agent.workspace.state.changed",
    ]);
    expect(JSON.stringify(events)).not.toContain(fixture.root);
    expect(JSON.stringify(events)).not.toContain(fixture.sibling);
  });

  it("rejects a stale content-bound transition", async () => {
    const fixture = await siblingRepository();
    const workspace = record(fixture.records.home.repositoryInstanceId, fixture.baseCommit);
    await createWorkspace({
      repositoryRoot: fixture.root,
      workspace,
      eventId: "evt_workspace_created_02",
    });
    await expect(
      updateWorkspace({
        repositoryRoot: fixture.root,
        workspaceId: workspace.workspaceId,
        expectedContentHash: `sha256:${"f".repeat(64)}`,
        eventId: "evt_workspace_ready_0002",
        expectedRevision: 1,
        expectedGeneration: 1,
        nextState: "ready",
        occurredAt: "2026-08-26T00:01:00Z",
        evidence: { hostInspected: true, markerMatched: true, checkoutClean: true },
      }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
  });
});

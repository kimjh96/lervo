import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentWorkforceError,
  claimAssignment,
  CONVERSATION_TASK_TYPE,
  createAssignment,
  listAssignments,
  listConversationChangedPaths,
  listWorkspaces,
  readAssignmentClaimRefusals,
  readConversationChangedPaths,
  recordConversationChangedPaths,
  recordConversationWorkspaceGeneration,
  registerAgent,
  widenConversationLease,
  type AgentWorkspace,
  type ConversationLeaseEvent,
  type WorkforceAssignment,
  type WidenConversationLeaseInput,
} from "../src/index.js";
import { heldChangedPaths } from "../src/conversation-changed-path-bounds.js";
import { readUnsealedChangedPathHolders } from "../src/conversation-changed-paths.js";

const execute = promisify(execFile);
const roots: string[] = [];
const NOW = new Date("2026-11-27T10:00:00.000Z");
const KEY = new Uint8Array(32).fill(7);
const LEAD_SESSION = `ses_terminal_${"a".repeat(24)}`;
const HOLDER_CONVERSATION = "wsp_0123456789abcdef01234567";
const CLAIMANT_CONVERSATION = `wsp_${"1".repeat(24)}`;
const hash = `sha256:${"a".repeat(64)}`;

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-changes-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_conversation_changes", now: NOW }),
  );
  await writeFile(resolve(root, "tracked.txt"), "base\n");
  await execute("git", ["-C", root, "init"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, baseCommit: stdout.trim() };
}

async function conversation(root: string) {
  const lead = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    responsibilityPaths: ["src"],
  });
  const created = await createAssignment({
    repositoryRoot: root,
    taskType: CONVERSATION_TASK_TYPE,
    roleId: "developer",
    acceptanceCriteria: ["The conversation's sealed change passes its verification."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: [],
    now: NOW,
  });
  const assignment = await claimAssignment({
    repositoryRoot: root,
    assignmentId: created.assignmentId,
    agentId: lead.agentId,
    sessionId: LEAD_SESSION,
    leaseDurationMs: 10 * 60_000,
    now: NOW,
  });
  return { lead, assignment };
}

/**
 * Another conversation's generation 1, in `ready`, bound to its lead's live conversation lease,
 * with a worktree directory, so its recorded changes hold their paths.
 */
async function holderGeneration(fixture: Awaited<ReturnType<typeof repository>>) {
  const records = await RepositoryCoordinationRecords.open(fixture.root);
  const { lead: holder, assignment } = await conversation(fixture.root);
  const worktree = resolve(fixture.root, "worktrees", "log-format");
  await mkdir(worktree, { recursive: true });
  const { workspace } = await recordConversationWorkspaceGeneration({
    repositoryRoot: fixture.root,
    conversationId: HOLDER_CONVERSATION,
    generation: 1,
    repositoryInstanceId: records.home.repositoryInstanceId,
    projectId: "prj_conversation_changes",
    assignmentId: assignment.assignmentId,
    agentId: holder.agentId,
    leaseGeneration: 1,
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: fixture.baseCommit,
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: `sha256:${"c".repeat(64)}`,
    ownerWorkspacePath: worktree,
    inspection: { hostInspected: true, markerMatched: true, checkoutClean: true },
    now: NOW,
  });
  return { holder, workspace, assignment, worktree };
}

function record(
  root: string,
  workspace: AgentWorkspace,
  changedPaths: readonly string[],
  workspaces: readonly AgentWorkspace[] = [workspace],
) {
  return recordConversationChangedPaths({
    repositoryRoot: root,
    workspace,
    changedPaths,
    measuredFrom: workspace.baseCommit,
    workspaces,
    now: NOW,
  });
}

describe("what a generation's changes hold", () => {
  it("names claimable paths, never runtime paths, and a glob name's directory", () => {
    expect(
      heldChangedPaths([
        "src/a.ts",
        ".lervo/state/notes.json",
        ".lervo/run",
        "docs/x[1].md",
        "docs/guide.md",
        "y*.md",
      ]),
    ).toEqual({
      paths: ["docs", "src/a.ts"],
      changedPathCount: 3,
      coalesced: false,
      overflow: false,
    });
  });

  it("coalesces past 10,000 paths or the byte bound, and never holds the checkout", () => {
    const nested = Array.from({ length: 10_001 }, (_, index) => `src/gen/f${index}.ts`);
    expect(heldChangedPaths(["README.md", ...nested])).toEqual({
      paths: ["README.md", "src/gen"],
      changedPathCount: 10_002,
      coalesced: true,
      overflow: false,
    });
    // 3,000 long paths pass the 2 MiB bound well below 10,000 entries.
    const long = Array.from({ length: 3_000 }, (_, index) => `gen/${"x".repeat(900)}/f${index}.ts`);
    expect(heldChangedPaths(long)).toEqual({
      paths: [`gen/${"x".repeat(900)}`],
      changedPathCount: 3_000,
      coalesced: true,
      overflow: false,
    });
    // Nothing below the root coalesces: the top-level entries hold, as many as fit, and overflow.
    const flat = Array.from(
      { length: 10_001 },
      (_, index) => `f${String(index).padStart(5, "0")}.ts`,
    );
    const overflowing = heldChangedPaths(flat);
    expect(overflowing).toMatchObject({ changedPathCount: 10_001, overflow: true });
    expect(overflowing.paths).toHaveLength(10_000);
    expect(overflowing.paths).not.toContain(".");
  });
});

describe("recording a generation's changed paths", () => {
  it("records them beside the record, replaces them whole, and prunes gone generations", async () => {
    const fixture = await repository();
    const { workspace } = await holderGeneration(fixture);
    await record(fixture.root, workspace, ["src/a.ts", "src/b.ts"]);
    const replaced = await record(fixture.root, workspace, ["src/b.ts"]);
    expect(replaced).toMatchObject({
      workspaceId: workspace.workspaceId,
      conversationId: HOLDER_CONVERSATION,
      generation: 1,
      baseCommit: fixture.baseCommit,
      measuredFrom: fixture.baseCommit,
      paths: ["src/b.ts"],
      overflow: false,
    });
    expect(await listConversationChangedPaths(fixture.root)).toEqual(
      new Map([[workspace.workspaceId, replaced]]),
    );
    expect(await readConversationChangedPaths(fixture.root, HOLDER_CONVERSATION)).toEqual({
      paths: ["src/b.ts"],
      total: 1,
      heldEntries: 1,
      coalesced: false,
      overflow: false,
      recordedAt: NOW.toISOString(),
    });
    expect(await readConversationChangedPaths(fixture.root, CLAIMANT_CONVERSATION)).toBeNull();
    const many = Array.from(
      { length: 150 },
      (_, index) => `src/f${String(index).padStart(3, "0")}.ts`,
    );
    await record(fixture.root, workspace, many);
    expect(await readConversationChangedPaths(fixture.root, HOLDER_CONVERSATION)).toMatchObject({
      paths: many.slice(0, 100),
      total: 150,
      heldEntries: 150,
    });

    // A generation whose record is gone keeps no file once any generation records again.
    const folder = (await RepositoryCoordinationRecords.open(fixture.root)).home.workforce;
    const gone = `wsp_${"e".repeat(24)}`;
    await writeFile(resolve(folder, "conversation-changes", `${gone}.json`), "{}", {
      mode: 0o600,
    });
    // A live record the caller did not list is reread and keeps its file.
    await record(fixture.root, workspace, ["src/b.ts"], []);
    expect(await readdir(resolve(folder, "conversation-changes"))).toEqual([
      `${workspace.workspaceId}.json`,
    ]);
  });

  it("reads a conversation's changes without writing anything", async () => {
    const fixture = await repository();
    const { stdout } = await execute("git", ["-C", fixture.root, "rev-parse", "--git-common-dir"]);
    const home = resolve(fixture.root, stdout.trim(), "lervo-coordination-v1");
    const before = await readdir(resolve(fixture.root, stdout.trim()));
    expect(await readConversationChangedPaths(fixture.root, HOLDER_CONVERSATION)).toBeNull();
    expect(await readdir(resolve(fixture.root, stdout.trim()))).toEqual(before);
    expect(before).not.toContain("lervo-coordination-v1");

    // With a home and a generation but no changes yet, it still creates no directory.
    await holderGeneration(fixture);
    const workforce = (await RepositoryCoordinationRecords.open(fixture.root)).home.workforce;
    expect(workforce.startsWith(home)).toBe(true);
    const listed = await readdir(workforce);
    expect(await readConversationChangedPaths(fixture.root, HOLDER_CONVERSATION)).toBeNull();
    expect(await readdir(workforce)).toEqual(listed);
    expect(listed).not.toContain("conversation-changes");
  });

  it("holds the recorded paths only while the generation is current, present, and recent", async () => {
    const fixture = await repository();
    const { holder, workspace, assignment, worktree } = await holderGeneration(fixture);
    await record(fixture.root, workspace, ["src/a.ts"]);
    const read = async (
      claimantConversationId: string | null,
      assignments: readonly WorkforceAssignment[] = [assignment],
      now = NOW,
    ) =>
      readUnsealedChangedPathHolders({
        repositoryRoot: fixture.root,
        workforceDirectory: (await RepositoryCoordinationRecords.open(fixture.root)).home.workforce,
        claimantConversationId,
        assignments,
        now,
      });
    expect(await read(CLAIMANT_CONVERSATION)).toEqual([
      {
        path: "src/a.ts",
        holderAgentId: holder.agentId,
        holderWorkspaceId: HOLDER_CONVERSATION,
        holderAssignmentId: workspace.assignmentId,
        code: "path_changed_unsealed",
      },
    ]);
    expect(await read(HOLDER_CONVERSATION)).toEqual([]);
    // An expired lease still holds for a day, then nothing does.
    const expiry = Date.parse(assignment.lease!.expiresAt);
    expect(await read(null, [assignment], new Date(expiry + 23 * 60 * 60_000))).toHaveLength(1);
    expect(await read(null, [assignment], new Date(expiry + 25 * 60 * 60_000))).toEqual([]);
    // A cancelled or missing assignment holds nothing.
    expect(await read(null, [{ ...assignment, lease: null }])).toEqual([]);
    expect(await read(null, [])).toEqual([]);
    // A retired conversation's worktree is gone, and so is its hold.
    await rm(worktree, { recursive: true });
    expect(await read(null)).toEqual([]);
  });

  it("keeps Lervo's own claims off a changed path, and never fails them on a bad record", async () => {
    const fixture = await repository();
    const folder = (await RepositoryCoordinationRecords.open(fixture.root)).home;
    const worker = await registerAgent({
      repositoryRoot: fixture.root,
      roleId: "developer",
      origin: "lervo",
    });
    const create = (expectedPaths: string[]) =>
      createAssignment({
        repositoryRoot: fixture.root,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["The change passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths,
        now: NOW,
      });
    const claim = async (expectedPaths: string[]) =>
      claimAssignment({
        repositoryRoot: fixture.root,
        assignmentId: (await create(expectedPaths)).assignmentId,
        agentId: worker.agentId,
        sessionId: "ses_worker_session_01",
        now: NOW,
      });
    // Without any changes file a claim reads no workspace record, so an invalid one fails nothing.
    const invalid = resolve(folder.workspaces, `wsp_${"f".repeat(24)}.json`);
    await writeFile(invalid, "{}", { mode: 0o600 });
    await expect(claim(["src/x.ts"])).resolves.toMatchObject({ status: "leased" });
    await rm(invalid);

    const { workspace } = await holderGeneration(fixture);
    await record(fixture.root, workspace, ["src/a.ts"]);
    await expect(claim(["src"])).rejects.toMatchObject({ code: "assignment_path_conflict" });
    await expect(claim(["src/other.ts"])).resolves.toMatchObject({ status: "leased" });
    // A waiter reads the same judgment without claiming or writing anything.
    const refusals = async (expectedPaths: string[]) =>
      readAssignmentClaimRefusals({
        repositoryRoot: fixture.root,
        assignment: await create(expectedPaths),
        assignments: await listAssignments(fixture.root),
        now: NOW,
      });
    // The worker's own earlier claims hold their files too, as live leases.
    expect(await refusals(["src"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "path_changed_unsealed",
          path: "src",
          holderWorkspaceId: HOLDER_CONVERSATION,
        }),
        expect.objectContaining({ code: "path_leased", path: "src" }),
      ]),
    );
    expect(await refusals(["docs"])).toEqual([]);
    // A path outside the agent's responsibility is not an overlap, and has its own code.
    const scoped = await registerAgent({
      repositoryRoot: fixture.root,
      roleId: "developer",
      origin: "lervo",
      responsibilityPaths: ["docs"],
    });
    await expect(
      claimAssignment({
        repositoryRoot: fixture.root,
        assignmentId: (await create(["src/elsewhere.ts"])).assignmentId,
        agentId: scoped.agentId,
        sessionId: "ses_scoped_session_01",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "assignment_path_outside_responsibility" });

    // A changes file this release cannot read, or one of a record it cannot read, holds nothing.
    const changes = resolve(folder.workforce, "conversation-changes");
    await writeFile(resolve(changes, `${workspace.workspaceId}.json`), "not json", { mode: 0o600 });
    await writeFile(resolve(changes, `wsp_${"d".repeat(24)}.json`), "{}", { mode: 0o644 });
    await expect(claim(["src/a.ts"])).resolves.toMatchObject({ status: "leased" });
  });
});

describe("regenerating a conversation lease", () => {
  function widen(
    root: string,
    input: Pick<WidenConversationLeaseInput, "assignmentId" | "agentId"> &
      Partial<WidenConversationLeaseInput>,
    events: ConversationLeaseEvent[] = [],
  ) {
    return widenConversationLease({
      repositoryRoot: root,
      sessionId: LEAD_SESSION,
      paths: ["src/a.ts"],
      mode: "request",
      detection: "tool",
      claimantWorkspaceId: CLAIMANT_CONVERSATION,
      claimPathKey: KEY,
      recordEvent: (event) => {
        events.push(event);
      },
      ...input,
    });
  }

  it("reacquires an expired lease under the next generation, keeping what no one took", async () => {
    const { root } = await repository();
    const { lead, assignment } = await conversation(root);
    const ids = { assignmentId: assignment.assignmentId, agentId: lead.agentId };
    await widen(root, { ...ids, paths: ["src/a.ts", "src/b.ts"], now: NOW });

    // After expiry another agent claims `src/b.ts`.
    const later = new Date(NOW.getTime() + 12 * 60_000);
    const other = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const taken = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["The change passes."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/b.ts"],
      now: later,
    });
    await claimAssignment({
      repositoryRoot: root,
      assignmentId: taken.assignmentId,
      agentId: other.agentId,
      sessionId: "ses_other_session_01",
      now: later,
    });
    await expect(widen(root, { ...ids, paths: ["src/c.ts"], now: later })).rejects.toMatchObject({
      code: "assignment_lease_conflict",
    });

    const events: ConversationLeaseEvent[] = [];
    const result = await widen(
      root,
      { ...ids, paths: ["src/c.ts"], regenerate: true, now: later },
      events,
    );
    expect(result).toMatchObject({
      status: "widened",
      leaseRegenerated: true,
      droppedPaths: ["src/b.ts"],
      addedPaths: ["src/c.ts"],
    });
    expect(result.assignment.expectedPaths).toEqual(["src/a.ts", "src/c.ts"]);
    expect(result.assignment.lease).toMatchObject({
      generation: 2,
      sessionId: LEAD_SESSION,
      acquiredAt: later.toISOString(),
      expiresAt: new Date(later.getTime() + 10 * 60_000).toISOString(),
    });
    expect(result.assignment.lastLeaseGeneration).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      "assignment.claimed",
      "assignment.lease.widened",
    ]);
    expect(events[0]!.payload).toMatchObject({ generation: 2, accessMode: "write" });
  });

  it("never trades a live lease between sessions of the same lead or another agent", async () => {
    const { root } = await repository();
    const { lead, assignment } = await conversation(root);
    const sibling = `ses_terminal_${"b".repeat(24)}`;
    const now = new Date(NOW.getTime() + 60_000);
    const ids = { assignmentId: assignment.assignmentId, agentId: lead.agentId };
    await expect(
      widen(root, { ...ids, sessionId: sibling, regenerate: true, now }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    const stranger = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const expired = new Date(NOW.getTime() + 11 * 60_000);
    await expect(
      widen(root, { ...ids, agentId: stranger.agentId, regenerate: true, now: expired }),
    ).rejects.toBeInstanceOf(AgentWorkforceError);
    // The lead's own sessions claim under the live lease's writer session, which stays.
    const kept = await widen(root, { ...ids, regenerate: true, now });
    expect(kept).toMatchObject({ status: "widened", leaseRegenerated: false });
    expect(kept.assignment.lease).toMatchObject({ sessionId: LEAD_SESSION, generation: 1 });
  });

  it("renews from a reconciliation that found nothing changed, once less than 5 minutes remain", async () => {
    const { root } = await repository();
    const { lead, assignment } = await conversation(root);
    const ids = { assignmentId: assignment.assignmentId, agentId: lead.agentId };
    const reconcile = (minutes: number, events: ConversationLeaseEvent[]) =>
      widenConversationLease({
        repositoryRoot: root,
        ...ids,
        sessionId: LEAD_SESSION,
        paths: [],
        mode: "reconcile",
        claimPathKey: KEY,
        recordEvent: (event) => {
          events.push(event);
        },
        now: new Date(NOW.getTime() + minutes * 60_000),
      });
    const early: ConversationLeaseEvent[] = [];
    await expect(reconcile(2, early)).resolves.toMatchObject({
      status: "covered",
      leaseRenewed: false,
    });
    expect(early).toEqual([]);
    const late: ConversationLeaseEvent[] = [];
    await expect(reconcile(7, late)).resolves.toMatchObject({
      status: "covered",
      leaseRenewed: true,
    });
    expect(late.map((event) => event.type)).toEqual(["assignment.lease.renewed"]);
    expect(await listWorkspaces(root)).toEqual([]);
  });
});

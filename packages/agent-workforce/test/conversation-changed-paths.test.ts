import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentWorkforceError,
  claimAssignment,
  conversationChangedPathHolders,
  CONVERSATION_TASK_TYPE,
  createAssignment,
  listConversationChangedPaths,
  listWorkspaces,
  readConversationChangedPaths,
  recordConversationChangedPaths,
  recordConversationWorkspaceGeneration,
  registerAgent,
  widenConversationLease,
  type AgentWorkspace,
  type ConversationLeaseEvent,
  type WidenConversationLeaseInput,
} from "../src/index.js";
import { heldChangedPaths } from "../src/conversation-changed-paths.js";

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

/** Another conversation's generation 1, in `ready`, whose changes then hold their paths. */
async function holderGeneration(fixture: Awaited<ReturnType<typeof repository>>) {
  const records = await RepositoryCoordinationRecords.open(fixture.root);
  const holder = await registerAgent({ repositoryRoot: fixture.root, roleId: "developer" });
  const { workspace } = await recordConversationWorkspaceGeneration({
    repositoryRoot: fixture.root,
    conversationId: HOLDER_CONVERSATION,
    generation: 1,
    repositoryInstanceId: records.home.repositoryInstanceId,
    projectId: "prj_conversation_changes",
    assignmentId: "asn_0123456789abcdef01234567",
    agentId: holder.agentId,
    leaseGeneration: 1,
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: fixture.baseCommit,
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: `sha256:${"c".repeat(64)}`,
    ownerWorkspacePath: "/workspaces/app/log-format-1a2b3c",
    inspection: { hostInspected: true, markerMatched: true, checkoutClean: true },
    now: NOW,
  });
  return { holder, workspace };
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
      changedPathCount: 2,
      coalesced: false,
      overflow: false,
    });
  });

  it("coalesces past 10,000 paths, and holds the checkout when nothing fits", () => {
    const nested = Array.from({ length: 10_001 }, (_, index) => `src/gen/f${index}.ts`);
    expect(heldChangedPaths(["README.md", ...nested])).toEqual({
      paths: ["README.md", "src/gen"],
      changedPathCount: 10_002,
      coalesced: true,
      overflow: false,
    });
    const flat = Array.from({ length: 10_001 }, (_, index) => `f${index}.ts`);
    expect(heldChangedPaths(flat)).toMatchObject({ paths: [], overflow: true });
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
      paths: ["src/b.ts"],
      overflow: false,
    });
    expect(await listConversationChangedPaths(fixture.root)).toEqual(
      new Map([[workspace.workspaceId, replaced]]),
    );
    expect(await readConversationChangedPaths(fixture.root, HOLDER_CONVERSATION)).toEqual({
      paths: ["src/b.ts"],
      total: 1,
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
    });

    // A generation that is gone keeps no record once any generation records again.
    const folder = (await RepositoryCoordinationRecords.open(fixture.root)).home.workforce;
    const gone = `wsp_${"e".repeat(24)}`;
    await writeFile(resolve(folder, "conversation-changes", `${gone}.json`), "{}", {
      mode: 0o600,
    });
    await record(fixture.root, workspace, ["src/b.ts"]);
    expect(await readdir(resolve(folder, "conversation-changes"))).toEqual([
      `${workspace.workspaceId}.json`,
    ]);
  });

  it("holds the recorded paths against other conversations until the base moves", async () => {
    const fixture = await repository();
    const { holder, workspace } = await holderGeneration(fixture);
    await record(fixture.root, workspace, ["src/a.ts"]);
    const changes = await listConversationChangedPaths(fixture.root);
    expect(conversationChangedPathHolders([workspace], CLAIMANT_CONVERSATION, changes)).toEqual([
      {
        path: "src/a.ts",
        holderAgentId: holder.agentId,
        holderWorkspaceId: HOLDER_CONVERSATION,
        holderAssignmentId: workspace.assignmentId,
        code: "path_changed_unsealed",
      },
    ]);
    expect(conversationChangedPathHolders([workspace], HOLDER_CONVERSATION, changes)).toEqual([]);
    const rebased = { ...workspace, baseCommit: "f".repeat(40) };
    expect(conversationChangedPathHolders([rebased], CLAIMANT_CONVERSATION, changes)).toEqual([]);

    const flat = Array.from({ length: 10_001 }, (_, index) => `f${index}.ts`);
    await record(fixture.root, workspace, flat);
    expect(
      conversationChangedPathHolders(
        [workspace],
        CLAIMANT_CONVERSATION,
        await listConversationChangedPaths(fixture.root),
      ),
    ).toMatchObject([{ path: ".", code: "path_changed_unsealed" }]);
  });

  it("keeps every claim, Lervo's own included, off a path a conversation changed", async () => {
    const fixture = await repository();
    const { workspace } = await holderGeneration(fixture);
    await record(fixture.root, workspace, ["src/a.ts"]);
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
    await expect(claim(["src"])).rejects.toMatchObject({ code: "assignment_path_conflict" });
    await expect(claim(["src/other.ts"])).resolves.toMatchObject({ status: "leased" });
  });
});

describe("regenerating a conversation lease", () => {
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

  it("takes the lease over from another session of the same lead, never another agent's", async () => {
    const { root } = await repository();
    const { lead, assignment } = await conversation(root);
    const resumed = `ses_terminal_${"b".repeat(24)}`;
    const now = new Date(NOW.getTime() + 60_000);
    const ids = { assignmentId: assignment.assignmentId, agentId: lead.agentId };
    const result = await widen(root, { ...ids, sessionId: resumed, regenerate: true, now });
    expect(result).toMatchObject({ status: "widened", leaseRegenerated: true });
    expect(result.assignment.lease).toMatchObject({ sessionId: resumed, generation: 2 });

    const stranger = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    await expect(
      widen(root, { ...ids, agentId: stranger.agentId, regenerate: true, now }),
    ).rejects.toBeInstanceOf(AgentWorkforceError);
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

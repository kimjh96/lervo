import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimAssignment,
  CONVERSATION_TASK_TYPE,
  createAssignment,
  createPinnedAssignment,
  listAssignments,
  registerAgent,
  widenConversationLease,
  type ConversationLeaseEvent,
  type WidenConversationLeaseInput,
  type WorkforceAgent,
  type WorkforceAssignment,
} from "../src/index.js";

const roots: string[] = [];
const NOW = new Date("2026-11-27T10:00:00.000Z");
const KEY = new Uint8Array(32).fill(7);
const LEAD_SESSION = `ses_terminal_${"a".repeat(24)}`;
const OWN_WORKSPACE = `wsp_${"1".repeat(24)}`;
const OTHER_WORKSPACE = `wsp_${"2".repeat(24)}`;

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-lease-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_conversation_lease_01", now: NOW }),
  );
  return root;
}

async function conversation(root: string, responsibilityPaths = ["src"]) {
  const lead = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    responsibilityPaths,
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

async function holder(root: string, expectedPaths: string[]) {
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    responsibilityPaths: ["src"],
  });
  const created = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["The holder's change passes."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths,
    now: NOW,
  });
  const assignment = await claimAssignment({
    repositoryRoot: root,
    assignmentId: created.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_holder_session_01",
    now: NOW,
  });
  return { agent, assignment };
}

/** A test override may unset `detection`, as a reconciliation does. */
type WideningOverrides = {
  [K in keyof WidenConversationLeaseInput]?: WidenConversationLeaseInput[K] | undefined;
};

function widen(
  root: string,
  lead: WorkforceAgent,
  assignment: WorkforceAssignment,
  events: ConversationLeaseEvent[],
  overrides: WideningOverrides = {},
) {
  const input: WideningOverrides = {
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: lead.agentId,
    sessionId: LEAD_SESSION,
    paths: ["src/a.ts"],
    mode: "request",
    detection: "tool",
    claimantWorkspaceId: OWN_WORKSPACE,
    claimPathKey: KEY,
    now: new Date(NOW.getTime() + 60_000),
    recordEvent: (event) => {
      events.push(event);
    },
    ...overrides,
  };
  if (input.detection === undefined) delete input.detection;
  return widenConversationLease(input as WidenConversationLeaseInput);
}

function pathDigest(path: string): string {
  return `hmac-sha256:${createHmac("sha256", KEY).update(`lervo.claim.path.v1\0${path}`).digest("hex")}`;
}

async function assignmentBytes(root: string, assignmentId: string): Promise<string> {
  const home = await resolveRepositoryCoordinationHome(root);
  return readFile(resolve(home.workforce, "assignments", `${assignmentId}.json`), "utf8");
}

describe("conversation assignments", () => {
  it("creates only a conversation assignment without paths and bounds it at 10,000", async () => {
    const root = await repository();
    const base = {
      repositoryRoot: root,
      roleId: "developer",
      acceptanceCriteria: ["Passes."],
      verificationSuiteIds: ["project.quick"],
      now: NOW,
    };
    await expect(
      createAssignment({ ...base, taskType: CONVERSATION_TASK_TYPE, expectedPaths: [] }),
    ).resolves.toMatchObject({ expectedPaths: [], accessMode: "write" });
    await expect(
      createAssignment({ ...base, taskType: "implementation", expectedPaths: [] }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
    const many = Array.from({ length: 129 }, (_, index) => `src/f${index}.ts`);
    await expect(
      createAssignment({ ...base, taskType: CONVERSATION_TASK_TYPE, expectedPaths: many }),
    ).resolves.toMatchObject({ taskType: CONVERSATION_TASK_TYPE });
    await expect(
      createAssignment({ ...base, taskType: "implementation", expectedPaths: many }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });
});

describe("widening a conversation lease", () => {
  it("adds paths, extends the expiry, advances the revision, and keeps the generation", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const events: ConversationLeaseEvent[] = [];
    const now = new Date(NOW.getTime() + 60_000);
    const result = await widen(root, lead, assignment, events, {
      paths: ["src/b.ts", "src/net/", "src/net/retry.ts"],
    });
    expect(result).toMatchObject({
      status: "widened",
      addedPaths: ["src/b.ts", "src/net"],
      refusals: [],
      refusalsRecorded: true,
    });
    expect(result.assignment).toMatchObject({
      expectedPaths: ["src/b.ts", "src/net"],
      revision: assignment.revision + 1,
      lease: {
        leaseId: assignment.lease!.leaseId,
        generation: assignment.lease!.generation,
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      },
    });
    expect(events).toEqual([
      {
        type: "assignment.lease.widened",
        occurredAt: now.toISOString(),
        actorAgentId: lead.agentId,
        payload: {
          assignmentId: assignment.assignmentId,
          agentId: lead.agentId,
          leaseGeneration: assignment.lease!.generation,
          revision: assignment.revision + 1,
          expectedPathDigest: `sha256:${createHash("sha256")
            .update(JSON.stringify(["src/b.ts", "src/net"]))
            .digest("hex")}`,
          expectedPathCount: 2,
          addedPathCount: 2,
          cause: "claim",
          occurredAt: now.toISOString(),
        },
      },
    ]);
    const covered = await widen(root, lead, result.assignment, events, {
      paths: ["src/net/retry.ts"],
    });
    expect(covered).toMatchObject({ status: "covered", addedPaths: [], refusals: [] });
    expect(covered.assignment.revision).toBe(result.assignment.revision);
    expect(events).toHaveLength(1);
  });

  it("refuses a whole request when one path overlaps another live write lease", async () => {
    const root = await repository();
    const held = await holder(root, ["src/a.ts"]);
    const { lead, assignment } = await conversation(root);
    const before = await assignmentBytes(root, assignment.assignmentId);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, events, {
      paths: ["src/a.ts", "src/b.ts"],
      detection: "shell",
    });
    expect(result).toMatchObject({
      status: "refused",
      addedPaths: [],
      refusals: [
        {
          code: "path_leased",
          path: "src/a.ts",
          holderAgentId: held.agent.agentId,
          holderAssignmentId: held.assignment.assignmentId,
          holderWorkspaceId: null,
        },
      ],
      refusalsRecorded: true,
    });
    expect(await assignmentBytes(root, assignment.assignmentId)).toBe(before);
    expect(events).toEqual([
      {
        type: "assignment.claim.refused",
        occurredAt: new Date(NOW.getTime() + 60_000).toISOString(),
        actorAgentId: lead.agentId,
        payload: {
          assignmentId: assignment.assignmentId,
          agentId: lead.agentId,
          leaseGeneration: assignment.lease!.generation,
          code: "path_leased",
          holderAgentId: held.agent.agentId,
          holderAssignmentId: held.assignment.assignmentId,
          holderWorkspaceId: null,
          pathDigest: pathDigest("src/a.ts"),
          detection: "shell",
          occurredAt: new Date(NOW.getTime() + 60_000).toISOString(),
        },
      },
    ]);
  });

  it("reconciles the conflict-free part and reports each conflict", async () => {
    const root = await repository();
    const held = await holder(root, ["src/held"]);
    const { lead, assignment } = await conversation(root);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, events, {
      mode: "reconcile",
      detection: undefined,
      paths: ["src/held/x.ts", "src/free.ts", "docs/outside.md"],
    });
    expect(result.status).toBe("widened");
    expect(result.addedPaths).toEqual(["src/free.ts"]);
    expect(result.assignment.expectedPaths).toEqual(["src/free.ts"]);
    expect(result.refusals).toEqual([
      {
        code: "outside_responsibility",
        path: "docs/outside.md",
        holderAgentId: null,
        holderAssignmentId: null,
        holderWorkspaceId: null,
      },
      {
        code: "path_leased",
        path: "src/held/x.ts",
        holderAgentId: held.agent.agentId,
        holderAssignmentId: held.assignment.assignmentId,
        holderWorkspaceId: null,
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "assignment.lease.widened",
      "assignment.claim.refused",
      "assignment.claim.refused",
    ]);
    expect(events[0]!.payload).toMatchObject({ cause: "reconcile", addedPathCount: 1 });
    expect(events.slice(1).map((event) => event.payload)).toMatchObject([
      { code: "outside_responsibility", detection: "reconcile", holderAgentId: null },
      { code: "path_leased", detection: "reconcile", pathDigest: pathDigest("src/held/x.ts") },
    ]);
  });

  it("refuses a path outside the lead's responsibility", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root, ["src/app"]);
    const result = await widen(root, lead, assignment, [], { paths: ["src/lib/x.ts"] });
    expect(result).toMatchObject({
      status: "refused",
      refusals: [{ code: "outside_responsibility", path: "src/lib/x.ts" }],
    });
  });

  it("never conflicts with a read-only lease", async () => {
    const root = await repository();
    const reader = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["src"],
    });
    const readOnly = await createPinnedAssignment({
      repositoryRoot: root,
      taskType: "review",
      roleId: "developer",
      acceptanceCriteria: ["Reviewed."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/a.ts"],
      expectedRoleVersion: reader.roleVersion,
      expectedRoleContractHash: reader.roleContractHash,
      requiredCapabilityHash: reader.capabilityHash,
      accessMode: "read_only",
      now: NOW,
    });
    await claimAssignment({
      repositoryRoot: root,
      assignmentId: readOnly.assignmentId,
      agentId: reader.agentId,
      sessionId: "ses_reader_session_01",
      now: NOW,
    });
    const { lead, assignment } = await conversation(root);
    await expect(widen(root, lead, assignment, [])).resolves.toMatchObject({
      status: "widened",
      addedPaths: ["src/a.ts"],
    });
  });

  it("judges other conversations' changed paths and skips its own workspace", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const other = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const result = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: ["src/a.ts", "src/mine.ts", "src/sealed/x.ts"],
      changedPathHolders: [
        {
          path: "src/a.ts",
          holderAgentId: other.agentId,
          holderWorkspaceId: OTHER_WORKSPACE,
          code: "path_changed_unsealed",
        },
        {
          path: "src/sealed",
          holderAgentId: other.agentId,
          holderWorkspaceId: OTHER_WORKSPACE,
          code: "path_awaiting_integration",
        },
        {
          path: "src/mine.ts",
          holderAgentId: lead.agentId,
          holderWorkspaceId: OWN_WORKSPACE,
          code: "path_changed_unsealed",
        },
      ],
    });
    expect(result.addedPaths).toEqual(["src/mine.ts"]);
    expect(result.refusals).toMatchObject([
      { code: "path_changed_unsealed", path: "src/a.ts", holderWorkspaceId: OTHER_WORKSPACE },
      { code: "path_awaiting_integration", path: "src/sealed/x.ts", holderAssignmentId: null },
    ]);
  });

  it("restores the assignment bytes when the widening event fails", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const before = await assignmentBytes(root, assignment.assignmentId);
    await expect(
      widen(root, lead, assignment, [], {
        recordEvent: () => {
          throw new Error("event store unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "workforce_write_failed" });
    expect(await assignmentBytes(root, assignment.assignmentId)).toBe(before);
  });

  it("refuses a claim from another session or for a non-conversation assignment", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    await expect(
      widen(root, lead, assignment, [], { sessionId: `ses_terminal_${"b".repeat(24)}` }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    await expect(widen(root, lead, assignment, [], { paths: ["."] })).rejects.toMatchObject({
      code: "assignment_invalid",
    });
    const held = await holder(root, ["src/other.ts"]);
    await expect(
      widen(root, held.agent, held.assignment, [], { sessionId: "ses_holder_session_01" }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });

  it("keeps claimAssignment refusing an overlap with a widened conversation lease", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    await widen(root, lead, assignment, [], { paths: ["src/net"] });
    const agent = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["src"],
    });
    const overlapping = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Rejected."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/net/retry.ts"],
    });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: overlapping.assignmentId,
        agentId: agent.agentId,
        sessionId: "ses_overlap_session_1",
        now: new Date(NOW.getTime() + 2 * 60_000),
      }),
    ).rejects.toMatchObject({ code: "assignment_path_conflict" });
  });
});

describe("a conversation lease past 10,000 entries", () => {
  const halves = [
    ...Array.from({ length: 5_000 }, (_, index) => `src/a/f${index}.ts`),
    ...Array.from({ length: 5_000 }, (_, index) => `src/b/f${index}.ts`),
  ];

  it("coalesces the deepest directory that overlaps no other holder", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const filled = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: halves,
    });
    expect(filled.assignment.expectedPaths).toHaveLength(10_000);
    expect((await listAssignments(root)).map((item) => item.expectedPaths.length)).toEqual([
      10_000,
    ]);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, filled.assignment, events, {
      paths: ["src/a/new.ts"],
    });
    expect(result.status).toBe("widened");
    expect(result.assignment.expectedPaths).toHaveLength(5_001);
    expect(result.assignment.expectedPaths[0]).toBe("src/a");
    expect(result.assignment.expectedPaths.some((path) => path.startsWith("src/a/"))).toBe(false);
    expect(events[0]!.payload).toMatchObject({ expectedPathCount: 5_001, addedPathCount: 1 });
  });

  it("refuses with lease_path_limit when every candidate overlaps another holder", async () => {
    const root = await repository();
    await holder(root, ["src/a/held.ts", "src/b/held.ts"]);
    const { lead, assignment } = await conversation(root);
    const filled = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: halves,
    });
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, filled.assignment, events, {
      paths: ["src/a/new.ts"],
    });
    expect(result).toMatchObject({
      status: "refused",
      refusals: [
        {
          code: "lease_path_limit",
          path: "src/a/new.ts",
          holderAgentId: null,
          holderAssignmentId: null,
          holderWorkspaceId: null,
        },
      ],
    });
    expect(result.assignment.expectedPaths).toHaveLength(10_000);
    expect(events.map((event) => event.payload)).toMatchObject([
      { code: "lease_path_limit", pathDigest: pathDigest("src/a/new.ts") },
    ]);
  });
});

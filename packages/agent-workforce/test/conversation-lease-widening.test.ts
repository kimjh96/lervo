import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimAssignment,
  conversationChangedPathHolders,
  conversationLeaseCovers,
  conversationLeaseHolderWorkspaceIds,
  CONVERSATION_TASK_TYPE,
  createAssignment,
  createPinnedAssignment,
  listAssignments,
  registerAgent,
  widenConversationLease,
  type AgentWorkspace,
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
  it("creates only a conversation assignment without paths and writes at most 128", async () => {
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
    ).rejects.toMatchObject({ code: "assignment_invalid" });
    await expect(
      createAssignment({ ...base, taskType: "implementation", expectedPaths: many }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });

  it("names no suite only for a conversation of a project that configures none", async () => {
    const root = await repository();
    const base = {
      repositoryRoot: root,
      roleId: "developer",
      acceptanceCriteria: ["Passes."],
      verificationSuiteIds: [],
      expectedPaths: [],
      now: NOW,
    };
    await expect(
      createAssignment({ ...base, taskType: CONVERSATION_TASK_TYPE }),
    ).resolves.toMatchObject({ verificationSuiteIds: [] });
    await expect(
      createAssignment({ ...base, taskType: "implementation", expectedPaths: ["src"] }),
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

  it("judges other conversations' changed paths and skips its own workspace and assignment", async () => {
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
        {
          path: "src/mine.ts",
          holderAgentId: lead.agentId,
          holderWorkspaceId: OTHER_WORKSPACE,
          holderAssignmentId: assignment.assignmentId,
          code: "path_awaiting_integration",
        },
      ],
    });
    expect(result.addedPaths).toEqual(["src/mine.ts"]);
    expect(result.refusals).toMatchObject([
      { code: "path_changed_unsealed", path: "src/a.ts", holderWorkspaceId: OTHER_WORKSPACE },
      { code: "path_awaiting_integration", path: "src/sealed/x.ts", holderAssignmentId: null },
    ]);
  });

  it("restores the bytes and keeps the refusals when the widening event fails", async () => {
    const root = await repository();
    const held = await holder(root, ["src/held.ts"]);
    const { lead, assignment } = await conversation(root);
    const before = await assignmentBytes(root, assignment.assignmentId);
    const refused: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: ["src/free.ts", "src/held.ts"],
      recordEvent: (event) => {
        if (event.type === "assignment.lease.widened") throw new Error("event store unavailable");
        refused.push(event);
      },
    });
    expect(result).toMatchObject({
      status: "deferred",
      addedPaths: [],
      refusals: [{ code: "path_leased", path: "src/held.ts", holderAgentId: held.agent.agentId }],
      refusalsRecorded: true,
    });
    expect(refused.map((event) => event.type)).toEqual(["assignment.claim.refused"]);
    expect(await assignmentBytes(root, assignment.assignmentId)).toBe(before);
  });

  it("renews a covered claim's lease only when less than 5 minutes remain", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const widened = await widen(root, lead, assignment, [], { paths: ["src/net"] });
    const events: ConversationLeaseEvent[] = [];
    const early = await widen(root, lead, widened.assignment, events, {
      paths: ["src/net/a.ts"],
      now: new Date(NOW.getTime() + 2 * 60_000),
    });
    expect(early).toMatchObject({ status: "covered", leaseRenewed: false });
    expect(events).toEqual([]);
    const late = new Date(NOW.getTime() + 7 * 60_000);
    const renewed = await widen(root, lead, widened.assignment, events, {
      paths: ["src/net/a.ts"],
      now: late,
    });
    expect(renewed).toMatchObject({ status: "covered", leaseRenewed: true, addedPaths: [] });
    expect(renewed.assignment.revision).toBe(widened.assignment.revision);
    expect(renewed.assignment.lease!.expiresAt).toBe(
      new Date(late.getTime() + 10 * 60_000).toISOString(),
    );
    expect(events).toEqual([
      {
        type: "assignment.lease.renewed",
        occurredAt: late.toISOString(),
        actorAgentId: lead.agentId,
        payload: {
          assignmentId: assignment.assignmentId,
          agentId: lead.agentId,
          leaseId: assignment.lease!.leaseId,
          generation: assignment.lease!.generation,
          expiresAt: renewed.assignment.lease!.expiresAt,
        },
      },
    ]);
  });

  it("records at most 32 refusal events per call and counts the rest", async () => {
    const root = await repository();
    await holder(root, ["src/held"]);
    const { lead, assignment } = await conversation(root);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, events, {
      mode: "reconcile",
      detection: undefined,
      paths: Array.from({ length: 40 }, (_, index) => `src/held/f${index}.ts`),
    });
    expect(result.refusals).toHaveLength(40);
    expect(result.omittedRefusalEvents).toBe(8);
    expect(events).toHaveLength(32);
  });

  it("refuses a claim from another session or for a non-conversation assignment", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    await expect(
      widen(root, lead, assignment, [], { sessionId: `ses_terminal_${"b".repeat(24)}` }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    for (const path of [".", "*", "src/*.ts", "src/a?.ts", "src/[ab].ts", "src/../a.ts"])
      await expect(widen(root, lead, assignment, [], { paths: [path] })).rejects.toMatchObject({
        code: "assignment_invalid",
      });
    await expect(
      widen(root, lead, assignment, [], {
        paths: Array.from({ length: 2_001 }, (_, index) => `src/f${index}.ts`),
      }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
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

describe("a conversation lease at its bounds", () => {
  /** Writes a record as a later release that writes up to 10,000 entries would. */
  async function writeExpectedPaths(root: string, assignmentId: string, paths: string[]) {
    const home = await resolveRepositoryCoordinationHome(root);
    const file = resolve(home.workforce, "assignments", `${assignmentId}.json`);
    const record = JSON.parse(await readFile(file, "utf8")) as WorkforceAssignment;
    record.expectedPaths = [...paths].sort();
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  }

  it("reads a 10,000-entry conversation record that a later release writes", async () => {
    const root = await repository();
    const { assignment } = await conversation(root);
    await writeExpectedPaths(
      root,
      assignment.assignmentId,
      Array.from({ length: 10_000 }, (_, index) => `src/d${index % 50}/f${index}.ts`),
    );
    expect((await listAssignments(root)).map((item) => item.expectedPaths.length)).toEqual([
      10_000,
    ]);
  });

  it("coalesces at 128 entries the deepest directory that overlaps no other holder", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const filled = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: [
        ...Array.from({ length: 64 }, (_, index) => `src/a/f${index}.ts`),
        ...Array.from({ length: 64 }, (_, index) => `src/b/f${index}.ts`),
      ],
    });
    expect(filled.assignment.expectedPaths).toHaveLength(128);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, filled.assignment, events, {
      paths: ["src/a/new.ts"],
    });
    expect(result.status).toBe("widened");
    expect(result.assignment.expectedPaths).toHaveLength(65);
    expect(result.assignment.expectedPaths[0]).toBe("src/a");
    expect(result.assignment.expectedPaths.some((path) => path.startsWith("src/a/"))).toBe(false);
    expect(events[0]!.payload).toMatchObject({ expectedPathCount: 65, addedPathCount: 1 });
  });

  it("refuses the 129th path with lease_path_limit when nothing can coalesce", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root, ["."]);
    const filled = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: Array.from({ length: 128 }, (_, index) => `f${index}.ts`),
    });
    expect(filled.assignment.expectedPaths).toHaveLength(128);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, filled.assignment, events, { paths: ["f128.ts"] });
    expect(result).toMatchObject({
      status: "refused",
      refusals: [
        {
          code: "lease_path_limit",
          path: "f128.ts",
          holderAgentId: null,
          holderAssignmentId: null,
          holderWorkspaceId: null,
        },
      ],
    });
    expect(result.assignment.expectedPaths).toHaveLength(128);
    expect(events.map((event) => event.payload)).toMatchObject([
      { code: "lease_path_limit", pathDigest: pathDigest("f128.ts") },
    ]);
  });

  it("refuses with lease_path_limit when every candidate overlaps another holder", async () => {
    const root = await repository();
    await holder(root, ["src/a/held.ts", "src/b/held.ts"]);
    const { lead, assignment } = await conversation(root);
    const filled = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: [
        ...Array.from({ length: 64 }, (_, index) => `src/a/f${index}.ts`),
        ...Array.from({ length: 64 }, (_, index) => `src/b/f${index}.ts`),
      ],
    });
    const result = await widen(root, lead, filled.assignment, [], { paths: ["src/a/new.ts"] });
    expect(result).toMatchObject({
      status: "refused",
      refusals: [{ code: "lease_path_limit", path: "src/a/new.ts" }],
    });
  });

  it("reconciles 10,000 paths into a 9,000-entry lease in short lock holds", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    await writeExpectedPaths(
      root,
      assignment.assignmentId,
      Array.from({ length: 9_000 }, (_, index) => `src/m${index % 90}/old${index}.ts`),
    );
    const started = performance.now();
    const result = await widen(root, lead, assignment, [], {
      mode: "reconcile",
      detection: undefined,
      paths: Array.from({ length: 10_000 }, (_, index) => `src/n${index % 30}/new${index}.ts`),
    });
    const elapsed = performance.now() - started;
    expect(result.status).toBe("widened");
    expect(result.assignment.expectedPaths).toHaveLength(120);
    expect(result.addedPaths).toHaveLength(10_000);
    // Five lock holds of 2,000 paths each; the quadratic judgment took 27 to 74 seconds here.
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe("naming holders and recording refusals once per turn", () => {
  it("names a lease holder's conversation workspace in the refusal and its event", async () => {
    const root = await repository();
    const held = await holder(root, ["src/a.ts"]);
    const { lead, assignment } = await conversation(root);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, events, {
      leaseHolderWorkspaceIds: new Map([[held.assignment.assignmentId, OTHER_WORKSPACE]]),
    });
    expect(result.refusals).toMatchObject([
      { code: "path_leased", holderWorkspaceId: OTHER_WORKSPACE },
    ]);
    expect(events[0]!.payload).toMatchObject({ holderWorkspaceId: OTHER_WORKSPACE });
    await expect(
      widen(root, lead, assignment, [], {
        leaseHolderWorkspaceIds: new Map([[held.assignment.assignmentId, "elsewhere"]]),
      }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });

  it("records no event for a path and holder the turn already recorded", async () => {
    const root = await repository();
    const held = await holder(root, ["src/a.ts", "src/b.ts"]);
    const { lead, assignment } = await conversation(root);
    const events: ConversationLeaseEvent[] = [];
    const result = await widen(root, lead, assignment, events, {
      paths: ["src/a.ts", "src/b.ts"],
      recordedRefusals: [{ path: "src/a.ts", holderAgentId: held.agent.agentId }],
    });
    // Both refusals stand; only the new one records an event.
    expect(result.refusals.map((refusal) => refusal.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(events.map((event) => event.payload)).toMatchObject([
      { pathDigest: pathDigest("src/b.ts") },
    ]);
    expect(result).toMatchObject({ refusalsRecorded: true, omittedRefusalEvents: 0 });
  });

  it("takes no lock when the guard before it throws, and records no refusal once aborted", async () => {
    const root = await repository();
    const held = await holder(root, ["src/a.ts"]);
    const { lead, assignment } = await conversation(root);
    const before = await assignmentBytes(root, assignment.assignmentId);
    const events: ConversationLeaseEvent[] = [];
    await expect(
      widen(root, lead, assignment, events, {
        paths: ["src/b.ts"],
        beforeLock: () => {
          throw Object.assign(new Error("late"), { code: "claim_deferred" });
        },
      }),
    ).rejects.toMatchObject({ code: "claim_deferred" });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      widen(root, lead, assignment, events, { paths: ["src/b.ts"], signal: cancelled.signal }),
    ).rejects.toBeDefined();
    expect(await assignmentBytes(root, assignment.assignmentId)).toBe(before);
    expect(events).toEqual([]);

    // Aborted while it held the lock: the refusal stands but records no event.
    const answered = new AbortController();
    const result = await widen(root, lead, assignment, events, {
      signal: answered.signal,
      beforeLock: () => answered.abort(),
    });
    expect(result.refusals).toMatchObject([
      { code: "path_leased", holderAgentId: held.agent.agentId },
    ]);
    expect(result).toMatchObject({ omittedRefusalEvents: 1 });
    expect(events).toEqual([]);
  });

  it("answers a claim inside its own lease only while more than 30 seconds remain", async () => {
    const root = await repository();
    const { lead, assignment } = await conversation(root);
    const widened = (await widen(root, lead, assignment, [], { paths: ["src/net"] })).assignment;
    const expiry = Date.parse(widened.lease!.expiresAt);
    const covers = (paths: string[], now: number, sessionId = LEAD_SESSION) =>
      conversationLeaseCovers(widened, {
        agentId: lead.agentId,
        sessionId,
        paths,
        now: new Date(now),
      });
    expect(covers(["src/net/retry.ts"], expiry - 31_000)).toBe(true);
    expect(covers(["src/net/retry.ts"], expiry - 30_000)).toBe(false);
    expect(covers(["src/net/retry.ts", "src/b.ts"], expiry - 60_000)).toBe(false);
    expect(covers(["src/net/retry.ts"], expiry - 60_000, "ses_other_session_01")).toBe(false);
    expect(covers([], expiry - 60_000)).toBe(false);
  });
});

describe("conversations' changed paths as holders", () => {
  const generation = (extra: Partial<AgentWorkspace>): AgentWorkspace =>
    ({
      workspaceId: `wsp_${"9".repeat(24)}`,
      kind: "conversation",
      conversationId: OTHER_WORKSPACE,
      generation: 1,
      assignmentId: `asn_${"b".repeat(24)}`,
      agentId: `agt_${"c".repeat(24)}`,
      state: "active",
      sealedResult: null,
      ...extra,
    }) as AgentWorkspace;

  it("holds a sealed change's paths until it integrates, and never the claimant's own", () => {
    const sealed = generation({
      state: "integration_pending",
      sealedResult: { changedPaths: ["src/a.ts", "."] } as AgentWorkspace["sealedResult"],
    });
    expect(conversationChangedPathHolders([sealed], OWN_WORKSPACE)).toEqual([
      {
        path: "src/a.ts",
        holderAgentId: sealed.agentId,
        holderWorkspaceId: OTHER_WORKSPACE,
        holderAssignmentId: sealed.assignmentId,
        code: "path_awaiting_integration",
      },
    ]);
    expect(conversationChangedPathHolders([sealed], OTHER_WORKSPACE)).toEqual([]);
    expect(
      conversationChangedPathHolders([{ ...sealed, state: "integrated" }], OWN_WORKSPACE),
    ).toEqual([]);
    // Unsealed generations record no changed paths until the turn's reconciliation lands.
    expect(conversationChangedPathHolders([generation({})], OWN_WORKSPACE)).toEqual([]);
    expect(conversationLeaseHolderWorkspaceIds([sealed, generation({ state: "removed" })])).toEqual(
      new Map([[sealed.assignmentId, OTHER_WORKSPACE]]),
    );
  });
});

import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { createAssignment, claimAssignment, listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  createWorkstreamUpdatePlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { runCli } from "../../cli/src/main.js";
import { revokeRepositoryMandate } from "../../cli/src/mandate-installation.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { observeNodeSupervisionAuthority } from "../src/supervision-authority.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(mode: string) {
  const f = await supervisionFixture(roots);
  const assignment = await createAssignment({
    repositoryRoot: f.root,
    workstreamId: f.binding.workstreamId,
    roleId: f.owner.roleId,
    taskType: "implementation",
    expectedPaths: ["src"],
    acceptanceCriteria: ["Save survives restart."],
    verificationSuiteIds: ["save.restart"],
  });
  if (mode === "leased")
    await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: assignment.assignmentId,
      agentId: f.owner.agentId,
      sessionId: "ses_cancellation_fixture",
      leaseDurationMs: 5000,
    });
  const original = (await readCurrentWorkstreamState(f.root))!;
  const plan = await createWorkstreamUpdatePlan({
    repositoryRoot: f.root,
    projectId: f.owner.projectId,
    snapshot: {
      ...original.snapshot,
      status: mode === "active" ? "active" : "cancelled",
      revision: original.snapshot.revision + 1,
      updatedAt: new Date().toISOString(),
    },
  });
  const errors: string[] = [];
  expect(
    await runCli(
      ["workstream", "update", "--stdin", "--apply", plan.planId, "--actor", "user", "--json"],
      {
        cwd: f.root,
        stdin: async () => JSON.stringify(plan.snapshot),
        stdout: () => undefined,
        stderr: (text) => errors.push(text),
      },
    ),
    errors.join("\n"),
  ).toBe(0);
  if (mode === "revoked")
    await revokeRepositoryMandate({
      root: f.root,
      ...f.binding,
      installationEventId: f.installed.eventId,
      reviewerId: f.mandate.appointingAuthorityId,
    });
  const now = () =>
    mode === "expired" || mode === "leased"
      ? new Date(Date.parse(f.mandate.expiresAt) + 1).toISOString()
      : new Date().toISOString();
  const open = () =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: {
        now,
        propose: f.ports.propose,
        execute: f.ports.execute,
        inspectEffect: f.ports.inspectEffect,
        recordAttention: f.ports.recordAttention,
      },
    });
  return { ...f, assignment, now, open };
}

it.each(["normal", "expired", "revoked"])(
  "reconciles canonical cancellation without a provider and survives restart (%s)",
  async (mode) => {
    const f = await fixture(mode);
    if (process.env.LERVO_INSTALLED_CLI !== undefined) {
      const observed = await promisify(execFile)(
        process.env.LERVO_INSTALLED_CLI,
        ["workstream", "current", "--json"],
        { cwd: f.root, timeout: 10000 },
      );
      expect(JSON.parse(observed.stdout).workstream.status).toBe("cancelled");
    }
    const storage = await openProjectStorage(f.root);
    try {
      if (mode !== "normal")
        await expect(observeNodeSupervisionAuthority(storage, f.binding, f.now)).rejects.toThrow();
      const first = await f.open();
      try {
        expect((await first.runCycle()).disposition).toBe("changed");
        expect((await listAssignments(f.root))[0]?.status).toBe("cancelled");
      } finally {
        await first.close();
      }
      const second = await f.open();
      try {
        expect((await second.runCycle()).report?.reasonCode).toBe(
          "canonical_cancellation_reconciled",
        );
        expect(f.counts()).toEqual({ proposals: 0, effects: 0 });
        expect(
          storage.events.list().filter((event) => event.type === "assignment.cancelled"),
        ).toHaveLength(1);
        expect(
          (await new SupervisionTaskSource(storage, f.binding, f.now).read()).execution.attempts,
        ).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      await storage.close();
    }
  },
);

it("retains an expired assignment lease and exposes the unresolved cancellation", async () => {
  const f = await fixture("leased");
  const before = await listAssignments(f.root);
  const runtime = await f.open();
  try {
    expect((await runtime.runCycle()).disposition).toBe("blocked");
    expect(await listAssignments(f.root)).toEqual(before);
    expect(f.counts()).toEqual({ proposals: 0, effects: 0 });
    expect(f.attention).toContainEqual(["cancellation_requires_effect_reconciliation"]);
  } finally {
    await runtime.close();
  }
});

it("rolls back cancellation when its canonical event cannot be committed", async () => {
  const f = await fixture("normal");
  const before = await listAssignments(f.root);
  const append = SQLiteEventStore.prototype.append;
  vi.spyOn(SQLiteEventStore.prototype, "append").mockImplementation(function (
    this: SQLiteEventStore,
    draft,
  ) {
    if (draft.type === "assignment.cancelled")
      throw new Error("fixture cancellation receipt failure");
    return append.call(this, draft);
  });
  const runtime = await f.open();
  try {
    await expect(runtime.runCycle()).rejects.toThrow();
    expect(await listAssignments(f.root)).toEqual(before);
    expect(f.counts()).toEqual({ proposals: 0, effects: 0 });
  } finally {
    await runtime.close();
  }
});

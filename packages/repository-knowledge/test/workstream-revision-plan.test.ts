import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkstreamStartPlan,
  applyWorkstreamUpdatePlan,
  createWorkstreamRevisionPlan,
  createWorkstreamStartPlan,
  readCurrentWorkstream,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workstream-revision-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_revision_test", now: new Date("2026-10-01") }),
  );
  return root;
}

function bookkeeping(recordedAt: string, commit: string | null) {
  return {
    recordedAt,
    repositoryHead: commit === null ? null : { commit, observedAt: recordedAt },
  };
}

const draft = {
  schemaVersion: 1,
  status: "active",
  title: "Server bookkeeping",
  objective: "Record write facts on the server.",
  nextActions: ["Plan."],
  blockers: [],
  notes: [],
  references: [],
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("server-owned workstream bookkeeping", () => {
  it("binds start and update plans to intent so a later invocation reproduces the plan ID", async () => {
    const root = await repository();
    const planned = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      draft,
      bookkeeping: bookkeeping("2026-10-05T10:00:00.000Z", "a".repeat(40)),
    });
    const later = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      draft: { ...draft, updatedAt: "1999-01-01T00:00:00.000Z" },
      bookkeeping: bookkeeping("2026-10-05T10:05:00.000Z", "b".repeat(40)),
    });
    expect(later.planId).toBe(planned.planId);
    expect(later.snapshot?.workstreamId).toBe(planned.snapshot?.workstreamId);
    await applyWorkstreamStartPlan({
      plan: later,
      now: new Date("2026-10-05T10:05:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readCurrentWorkstream(root)).toMatchObject({
      revision: 1,
      updatedAt: "2026-10-05T10:05:00.000Z",
      repositoryHead: { commit: "b".repeat(40) },
    });

    const change = { kind: "patch" as const, value: { nextActions: ["Apply."] } };
    const first = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      change,
      bookkeeping: bookkeeping("2026-10-05T11:00:00.000Z", "c".repeat(40)),
    });
    const second = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      change,
      bookkeeping: bookkeeping("2026-10-05T11:01:00.000Z", "d".repeat(40)),
    });
    expect(first.status).toBe("ready");
    expect(second.planId).toBe(first.planId);
    expect(second.desiredSnapshotContentHash).not.toBe(first.desiredSnapshotContentHash);
    await applyWorkstreamUpdatePlan({
      plan: second,
      now: new Date("2026-10-05T11:01:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readCurrentWorkstream(root)).toMatchObject({
      revision: 2,
      nextActions: ["Apply."],
      updatedAt: "2026-10-05T11:01:00.000Z",
      repositoryHead: { commit: "d".repeat(40) },
    });

    const changedIntent = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      change,
      bookkeeping: bookkeeping("2026-10-05T11:02:00.000Z", null),
    });
    expect(changedIntent.planId).not.toBe(first.planId);
  });

  it("blocks an update without a current workstream or with a stale revision assertion", async () => {
    const root = await repository();
    const missing = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      change: { kind: "patch", value: {} },
      bookkeeping: bookkeeping("2026-10-05T11:00:00.000Z", null),
    });
    expect(missing).toMatchObject({ status: "blocked", operations: [] });
    expect(missing.blockers.map((blocker) => blocker.code)).toContain("missing_current_workstream");
    await applyWorkstreamStartPlan({
      plan: await createWorkstreamStartPlan({
        repositoryRoot: root,
        projectId: "prj_revision_test",
        draft,
        bookkeeping: bookkeeping("2026-10-05T10:00:00.000Z", null),
      }),
      now: new Date("2026-10-05T10:00:00.000Z"),
      recordApplied: () => undefined,
    });
    const stale = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: "prj_revision_test",
      change: { kind: "patch", value: { revision: 5 } },
      bookkeeping: bookkeeping("2026-10-05T11:00:00.000Z", null),
    });
    expect(stale).toMatchObject({ status: "blocked", operations: [] });
    expect(stale.blockers.map((blocker) => blocker.code)).toEqual(["invalid_revision"]);
  });
});

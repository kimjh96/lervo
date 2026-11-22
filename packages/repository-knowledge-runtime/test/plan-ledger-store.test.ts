import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import { planLedgerLines } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import {
  capturePlanItem,
  closePlanItem,
  readPlanLedger,
  updatePlanItem,
} from "../src/plan-ledger-store.js";

const execute = promisify(execFile);
const roots: string[] = [];
const opened: ProjectStorage[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((storage) => storage.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const agentSource = {
  origin: "agent_command" as const,
  provider: null,
  sessionDigest: null,
  transcriptOffset: null,
};

async function repository(writableEventSchemaVersion: 8 | 9 = 9) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-plan-ledger-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_plan_ledger01" }));
  const git = (...args: string[]) =>
    execute("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@lervo.invalid", ...args]);
  await git("init", "-q", "-b", "main");
  await writeFile(resolve(root, "README.md"), "# Fixture\n");
  await git("add", "README.md");
  await git("commit", "-q", "-m", "fixture");
  const paths = resolveProjectPaths(root);
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion,
  });
  const artifacts = await FileSystemCas.open(paths.cas);
  const storage: ProjectStorage = {
    manifest,
    paths,
    events,
    artifacts,
    writableEventSchemaVersion,
    close: async () => events.close(),
  };
  opened.push(storage);
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  return { root, storage, git, head };
}

describe("plan ledger store (ADR-0563)", () => {
  it("keeps items as a tree of schema 9 events and replays a capture as the same item", async () => {
    const { storage } = await repository();
    const objective = capturePlanItem(storage, {
      parentId: null,
      kind: "objective",
      title: "Make the Lervo core solid",
      source: agentSource,
    });
    const step = capturePlanItem(storage, {
      parentId: objective.itemId,
      kind: "plan",
      title: "Plan ledger slice 1",
      source: agentSource,
    });
    expect(
      capturePlanItem(storage, {
        parentId: objective.itemId,
        kind: "plan",
        title: "plan   ledger slice 1",
        source: agentSource,
      }).itemId,
    ).toBe(step.itemId);
    const events = storage.events.list({ types: ["plan.item.captured"] });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.schemaVersion === 9)).toBe(true);
    expect(
      planLedgerLines(readPlanLedger(storage), { open: true }).map((line) => line.depth),
    ).toEqual([0, 1]);
    expect(updatePlanItem(storage, { itemId: step.itemId, state: "in_progress" }).state).toBe(
      "in_progress",
    );
  });

  it("closes an item as done only with evidence Lervo observes", async () => {
    const { root, storage, head, git } = await repository();
    const item = capturePlanItem(storage, {
      parentId: null,
      kind: "finding",
      title: "Fix the stale idle Node health",
      source: agentSource,
    });
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: item.itemId,
        state: "done",
        reason: "Fixed",
      }),
    ).rejects.toMatchObject({ code: "plan_item_evidence_required" });
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: item.itemId,
        state: "done",
        reason: "Fixed",
        evidence: [{ kind: "commit", ref: "a".repeat(40), branch: null }],
      }),
    ).rejects.toMatchObject({ code: "plan_item_evidence_unverified" });
    // A commit on another branch is not evidence for main.
    await git("checkout", "-q", "-b", "side");
    await writeFile(resolve(root, "side.md"), "side\n");
    await git("add", "side.md");
    await git("commit", "-q", "-m", "side");
    const side = (await git("rev-parse", "HEAD")).stdout.trim();
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: item.itemId,
        state: "done",
        reason: "Fixed",
        evidence: [{ kind: "commit", ref: side, branch: "main" }],
      }),
    ).rejects.toMatchObject({ code: "plan_item_evidence_unverified" });
    const closed = await closePlanItem(storage, {
      repositoryRoot: root,
      itemId: item.itemId,
      state: "done",
      reason: "Fixed on main",
      evidence: [{ kind: "commit", ref: head, branch: "main" }],
    });
    expect(closed).toMatchObject({ state: "done", closed: { reason: "Fixed on main" } });
    // Nothing reopens or changes a closed item.
    expect(() => updatePlanItem(storage, { itemId: item.itemId, state: "open" })).toThrow(
      /already done/u,
    );
    expect(planLedgerLines(readPlanLedger(storage), { open: true })).toEqual([]);
  });

  it("records why an item was cancelled or superseded", async () => {
    const { root, storage } = await repository();
    const first = capturePlanItem(storage, {
      parentId: null,
      kind: "plan",
      title: "Old plan",
      source: agentSource,
    });
    const second = capturePlanItem(storage, {
      parentId: null,
      kind: "plan",
      title: "New plan",
      source: agentSource,
    });
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: first.itemId,
        state: "superseded",
        reason: "Replaced",
      }),
    ).rejects.toMatchObject({ code: "plan_item_invalid" });
    expect(
      await closePlanItem(storage, {
        repositoryRoot: root,
        itemId: first.itemId,
        state: "superseded",
        reason: "Replaced by the new plan",
        supersededBy: second.itemId,
      }),
    ).toMatchObject({ state: "superseded", closed: { supersededBy: second.itemId } });
    expect(
      (
        await closePlanItem(storage, {
          repositoryRoot: root,
          itemId: second.itemId,
          state: "cancelled",
          reason: "The owner withdrew it",
        })
      ).state,
    ).toBe("cancelled");
  });

  it("makes work that comes back after closing a new item, and refuses a parent cycle", async () => {
    const { root, storage } = await repository();
    const parent = capturePlanItem(storage, {
      parentId: null,
      kind: "plan",
      title: "Parent",
      source: agentSource,
    });
    const child = capturePlanItem(storage, {
      parentId: parent.itemId,
      kind: "plan",
      title: "Child",
      source: agentSource,
    });
    expect(() =>
      updatePlanItem(storage, { itemId: parent.itemId, parentId: child.itemId }),
    ).toThrow(expect.objectContaining({ code: "plan_item_invalid" }));
    await closePlanItem(storage, {
      repositoryRoot: root,
      itemId: child.itemId,
      state: "cancelled",
      reason: "Withdrawn",
    });
    const again = capturePlanItem(storage, {
      parentId: parent.itemId,
      kind: "plan",
      title: "Child",
      source: agentSource,
    });
    expect(again.itemId).not.toBe(child.itemId);
    expect(again.state).toBe("open");
  });

  it("records commit evidence by its full id and never accepts a ledger event", async () => {
    const { root, storage, head } = await repository();
    const item = capturePlanItem(storage, {
      parentId: null,
      kind: "plan",
      title: "Short id",
      source: agentSource,
    });
    const captured = storage.events.list({ types: ["plan.item.captured"] }).at(-1)!;
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: item.itemId,
        state: "done",
        reason: "Self proof",
        evidence: [{ kind: "event", ref: captured.eventId, branch: null }],
      }),
    ).rejects.toMatchObject({ code: "plan_item_evidence_unverified" });
    await expect(
      closePlanItem(storage, {
        repositoryRoot: root,
        itemId: item.itemId,
        state: "done",
        reason: "Bad branch",
        evidence: [{ kind: "commit", ref: head, branch: "--all" }],
      }),
    ).rejects.toMatchObject({ code: "plan_item_evidence_unverified" });
    const closed = await closePlanItem(storage, {
      repositoryRoot: root,
      itemId: item.itemId,
      state: "done",
      reason: "Landed",
      evidence: [{ kind: "commit", ref: head.slice(0, 9), branch: "main" }],
    });
    expect(closed.closed?.evidence).toEqual([{ kind: "commit", ref: head, branch: "main" }]);
  });

  it("refuses to write before the schema 9 writer is active", async () => {
    const { storage } = await repository(8);
    expect(() =>
      capturePlanItem(storage, {
        parentId: null,
        kind: "plan",
        title: "Too early",
        source: agentSource,
      }),
    ).toThrow(expect.objectContaining({ code: "plan_ledger_inactive" }));
  });
});

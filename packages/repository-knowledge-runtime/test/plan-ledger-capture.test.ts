import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
import { afterEach, describe, expect, it } from "vitest";

import {
  capturePlanItemsFromAssessment,
  MAXIMUM_OPEN_PLAN_CANDIDATES,
  openPlanItemsForCapture,
} from "../src/plan-ledger-capture.js";
import { capturePlanItem, readPlanLedger } from "../src/plan-ledger-store.js";

const execute = promisify(execFile);
const roots: string[] = [];
const opened: ProjectStorage[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((storage) => storage.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storage(writableEventSchemaVersion: 8 | 9 = 9): Promise<ProjectStorage> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-plan-capture-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_plan_capture01" }));
  await execute("git", ["-C", root, "init", "-q", "-b", "main"]);
  const paths = resolveProjectPaths(root);
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion,
  });
  const value: ProjectStorage = {
    manifest,
    paths,
    events,
    artifacts: await FileSystemCas.open(paths.cas),
    writableEventSchemaVersion,
    close: async () => events.close(),
  };
  opened.push(value);
  return value;
}

describe("plan items from owner-turn assessments (ADR-0563 S2)", () => {
  it("keeps explicit work open, uncertain work a candidate, and only cited shown parents", async () => {
    const store = await storage();
    const objective = capturePlanItem(store, {
      parentId: null,
      kind: "objective",
      title: "Core loop",
      source: {
        origin: "agent_command",
        provider: null,
        sessionDigest: null,
        transcriptOffset: null,
      },
    });
    const shown = openPlanItemsForCapture(store);
    expect(shown).toEqual([{ itemId: objective.itemId, kind: "objective", title: "Core loop" }]);
    const result = capturePlanItemsFromAssessment({
      storage: store,
      provider: "claude",
      shown,
      now: new Date("2026-11-22T12:00:00Z"),
      response: {
        planItems: [
          {
            kind: "directive",
            title: "Fix the idle Node health",
            confidence: "high",
            parent: "p1",
          },
          {
            kind: "plan",
            title: "Canary the release on WSL",
            confidence: "medium",
            parent: "p9",
          },
        ],
      },
    });
    expect(result).toEqual({ status: "captured", capturedCount: 2 });
    const items = [...readPlanLedger(store).items.values()];
    expect(
      items.map(({ title, state, parentId, source }) => ({
        title,
        state,
        parentId,
        origin: source.origin,
      })),
    ).toEqual([
      { title: "Core loop", state: "open", parentId: null, origin: "agent_command" },
      {
        title: "Fix the idle Node health",
        state: "open",
        parentId: objective.itemId,
        origin: "transcript",
      },
      {
        title: "Canary the release on WSL",
        state: "candidate",
        parentId: null,
        origin: "transcript",
      },
    ]);
    // The same assessment again is the same items.
    capturePlanItemsFromAssessment({
      storage: store,
      provider: "claude",
      shown,
      now: new Date("2026-11-22T12:05:00Z"),
      response: {
        planItems: [
          {
            kind: "directive",
            title: "Fix the idle Node health",
            confidence: "high",
            parent: "p1",
          },
        ],
      },
    });
    expect(readPlanLedger(store).items.size).toBe(3);
  });

  it("treats the same title under the same parent as one item and confirms a restated candidate", async () => {
    const store = await storage();
    const capture = (confidence: string, kind = "plan", title = "Fix the follower PATH") =>
      capturePlanItemsFromAssessment({
        storage: store,
        provider: "claude",
        shown: [],
        now: new Date(),
        response: { planItems: [{ kind, title, confidence, parent: null }] },
      });
    capturePlanItem(store, {
      parentId: null,
      kind: "directive",
      title: "Ship the canary",
      source: {
        origin: "agent_command",
        provider: null,
        sessionDigest: null,
        transcriptOffset: null,
      },
    });
    expect(capture("high", "plan", "ship  the canary")).toEqual({
      status: "captured",
      capturedCount: 0,
    });
    expect(capture("low")).toEqual({ status: "captured", capturedCount: 1 });
    expect(capture("high", "finding")).toEqual({ status: "captured", capturedCount: 0 });
    expect(
      [...readPlanLedger(store).items.values()].map(({ title, state }) => [title, state]),
    ).toEqual([
      ["Ship the canary", "open"],
      ["Fix the follower PATH", "open"],
    ]);
  });

  it("drops secret-bearing titles and bounds open candidates", async () => {
    const store = await storage();
    const capture = (titles: string[]) =>
      capturePlanItemsFromAssessment({
        storage: store,
        provider: "claude",
        shown: [],
        now: new Date(),
        response: {
          planItems: titles.map((title) => ({
            kind: "plan",
            title,
            confidence: "low",
            parent: null,
          })),
        },
      });
    expect(
      capture(["Rotate the key sk-live-1234567890abcdef", "Clean /Users/jonghyeok/secret"]),
    ).toEqual({
      status: "captured",
      capturedCount: 0,
    });
    for (let batch = 0; batch < MAXIMUM_OPEN_PLAN_CANDIDATES / 8 + 1; batch += 1)
      capture(Array.from({ length: 8 }, (_, index) => `Candidate ${batch}-${index}`));
    expect(
      [...readPlanLedger(store).items.values()].filter((item) => item.state === "candidate"),
    ).toHaveLength(MAXIMUM_OPEN_PLAN_CANDIDATES);
  });

  it("shows in-progress items first, then the most recently changed", async () => {
    const store = await storage();
    const source = {
      origin: "agent_command" as const,
      provider: null,
      sessionDigest: null,
      transcriptOffset: null,
    };
    const old = capturePlanItem(store, {
      parentId: null,
      kind: "plan",
      title: "Old",
      source,
      now: new Date("2026-11-01T00:00:00Z"),
    });
    const recent = capturePlanItem(store, {
      parentId: null,
      kind: "plan",
      title: "Recent",
      source,
      now: new Date("2026-11-22T00:00:00Z"),
    });
    const started = capturePlanItem(store, {
      parentId: null,
      kind: "plan",
      title: "Started",
      source,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    const { updatePlanItem } = await import("../src/plan-ledger-store.js");
    updatePlanItem(store, {
      itemId: started.itemId,
      state: "in_progress",
      now: new Date("2026-10-02T00:00:00Z"),
    });
    expect(openPlanItemsForCapture(store).map((item) => item.itemId)).toEqual([
      started.itemId,
      recent.itemId,
      old.itemId,
    ]);
  });

  it("writes nothing before schema 9 and ignores a malformed list", async () => {
    const early = await storage(8);
    expect(
      capturePlanItemsFromAssessment({
        storage: early,
        provider: "claude",
        shown: [],
        now: new Date(),
        response: {
          planItems: [{ kind: "plan", title: "Too early", confidence: "high", parent: null }],
        },
      }),
    ).toEqual({ status: "inactive", capturedCount: 0 });
    expect(openPlanItemsForCapture(early)).toEqual([]);
    const store = await storage();
    expect(
      capturePlanItemsFromAssessment({
        storage: store,
        provider: "claude",
        shown: [],
        now: new Date(),
        response: { planItems: "everything" },
      }),
    ).toEqual({ status: "invalid", capturedCount: 0 });
  });
});

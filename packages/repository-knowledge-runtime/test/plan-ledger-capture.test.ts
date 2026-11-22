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

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
import { afterEach, describe, expect, it } from "vitest";

import { openPlanItemsForCapture } from "../src/plan-ledger-capture.js";
import { closePlanItemsFromAssessment } from "../src/plan-ledger-closure.js";
import { capturePlanItem, readPlanLedger } from "../src/plan-ledger-store.js";

const execute = promisify(execFile);
const roots: string[] = [];
const opened: ProjectStorage[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((storage) => storage.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Lervo Test",
      "-c",
      "user.email=test@example.com",
      ...args,
    ])
  ).stdout.trim();
}

async function storage(writableEventSchemaVersion: 8 | 9 = 9) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-plan-closure-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_plan_closure01" }));
  await git(root, "init", "-q", "-b", "main");
  await writeFile(resolve(root, "a.txt"), "a\n");
  await git(root, "add", "a.txt");
  await git(root, "commit", "-q", "-m", "feat: first");
  await git(root, "tag", "v1.0.0");
  await git(root, "checkout", "-q", "-b", "topic");
  await writeFile(resolve(root, "b.txt"), "b\n");
  await git(root, "add", "b.txt");
  await git(root, "commit", "-q", "-m", "fix: topic");
  await git(root, "checkout", "-q", "main");
  await git(
    root,
    "merge",
    "-q",
    "--no-ff",
    "-m",
    "Merge pull request #351 from owner/topic",
    "topic",
  );
  const merge = await git(root, "rev-parse", "HEAD");
  // A first-parent commit whose body, not subject, names (#35): never evidence for #35.
  await git(
    root,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Merge pull request #400 from owner/x",
    "-m",
    "Follow-up to the abandoned attempt (#35)",
  );
  await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
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
  return { root, store: value, merge };
}

const source = {
  origin: "agent_command" as const,
  provider: null,
  sessionDigest: null,
  transcriptOffset: null,
};

const now = new Date();

function items(store: ProjectStorage, titles: string[], at = now) {
  for (const title of titles)
    capturePlanItem(store, { parentId: null, kind: "plan", title, source, now: at });
  return openPlanItemsForCapture(store);
}

const done = (reference: string, fields: Record<string, unknown>) => ({
  reference,
  state: "done",
  pullRequest: null,
  release: null,
  supersededBy: null,
  ...fields,
});

function titled(store: ProjectStorage, title: string) {
  return [...readPlanLedger(store).items.values()].find((item) => item.title === title)!;
}

describe("closing plan items an assessment reports finished (ADR-0563)", () => {
  it("closes done only with evidence the exchange names and Lervo observes", async () => {
    const { root, store, merge } = await storage();
    const shown = items(store, [
      "Merge the fix",
      "Release one",
      "Merge 999",
      "Unnamed",
      "Body only",
      "Second claim",
    ]);
    const ref = (title: string) => `p${shown.findIndex((item) => item.title === title) + 1}`;
    const result = await closePlanItemsFromAssessment({
      storage: store,
      repositoryRoot: root,
      shown,
      now,
      exchange: ["Merged PR #351 and released v1.0.0.", "Also #999 and #35 are done."],
      response: {
        closedPlanItems: [
          done(ref("Merge the fix"), { pullRequest: 351 }),
          done(ref("Release one"), { release: "v1.0.0" }),
          // Named, but no merge commit exists.
          done(ref("Merge 999"), { pullRequest: 999 }),
          // Merged, but the exchange never names it.
          done(ref("Unnamed"), { pullRequest: 400 }),
          // Named, but (#35) appears only in a commit body.
          done(ref("Body only"), { pullRequest: 35 }),
          // The same pull request cannot finish a second item.
          done(ref("Second claim"), { pullRequest: 351 }),
        ],
      },
    });
    expect(result).toEqual({ status: "closed", closedCount: 2 });
    expect(titled(store, "Merge the fix")).toMatchObject({
      state: "done",
      closed: { evidence: [{ kind: "commit", ref: merge, branch: "origin/main" }] },
    });
    expect(titled(store, "Release one")).toMatchObject({
      state: "done",
      closed: { evidence: [{ kind: "release", ref: "v1.0.0" }] },
    });
    for (const title of ["Merge 999", "Unnamed", "Body only", "Second claim"])
      expect(titled(store, title).state).toBe("open");
  });

  it("never closes with evidence older than the item, or without an integration branch", async () => {
    const { root, store } = await storage();
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const shown = items(store, ["Later work", "Later release"], later);
    const result = await closePlanItemsFromAssessment({
      storage: store,
      repositoryRoot: root,
      shown,
      now: later,
      exchange: ["#351 and v1.0.0 are done."],
      response: {
        closedPlanItems: [done("p1", { pullRequest: 351 }), done("p2", { release: "v1.0.0" })],
      },
    });
    expect(result).toEqual({ status: "closed", closedCount: 0 });
    await git(root, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    await git(root, "update-ref", "-d", "refs/remotes/origin/main");
    const fresh = items(store, ["Fresh merge"]);
    const reference = `p${fresh.findIndex((item) => item.title === "Fresh merge") + 1}`;
    expect(
      await closePlanItemsFromAssessment({
        storage: store,
        repositoryRoot: root,
        shown: fresh,
        now,
        exchange: ["#351 merged."],
        response: { closedPlanItems: [done(reference, { pullRequest: 351 })] },
      }),
    ).toEqual({ status: "closed", closedCount: 0 });
  });

  it("supersedes only for another shown item that stays open", async () => {
    const { root, store } = await storage();
    const shown = items(store, ["Old plan", "New plan", "Loop a", "Loop b", "Gone", "Its heir"]);
    const ref = (title: string) => `p${shown.findIndex((item) => item.title === title) + 1}`;
    const supersede = (from: string, to: string) => ({
      reference: ref(from),
      state: "superseded",
      pullRequest: null,
      release: null,
      supersededBy: ref(to),
    });
    const result = await closePlanItemsFromAssessment({
      storage: store,
      repositoryRoot: root,
      shown,
      now,
      exchange: ["v1.0.0 shipped."],
      response: {
        closedPlanItems: [
          supersede("Old plan", "New plan"),
          // Two items that replace each other: neither closes.
          supersede("Loop a", "Loop b"),
          supersede("Loop b", "Loop a"),
          // A replacement that this response closes is no replacement.
          supersede("Gone", "Its heir"),
          done(ref("Its heir"), { release: "v1.0.0" }),
          {
            reference: "p30",
            state: "superseded",
            pullRequest: null,
            release: null,
            supersededBy: ref("New plan"),
          },
          done(ref("New plan"), { pullRequest: null, release: null }),
        ],
      },
    });
    expect(result).toEqual({ status: "closed", closedCount: 2 });
    expect(titled(store, "Old plan")).toMatchObject({
      state: "superseded",
      closed: { supersededBy: titled(store, "New plan").itemId },
    });
    expect(titled(store, "Its heir").state).toBe("done");
    for (const title of ["New plan", "Loop a", "Loop b", "Gone"])
      expect(titled(store, title).state).toBe("open");
  });

  it("writes nothing before schema 9 and fails only on a non-list", async () => {
    const inactive = await storage(8);
    expect(
      await closePlanItemsFromAssessment({
        storage: inactive.store,
        repositoryRoot: inactive.root,
        shown: [],
        exchange: [],
        now,
        response: { closedPlanItems: [] },
      }),
    ).toEqual({ status: "inactive", closedCount: 0 });
    const { root, store } = await storage();
    const call = (response: unknown) =>
      closePlanItemsFromAssessment({
        storage: store,
        repositoryRoot: root,
        shown: [],
        exchange: [],
        now,
        response,
      });
    expect(await call({ closedPlanItems: "all" })).toEqual({ status: "invalid", closedCount: 0 });
    expect(await call({})).toEqual({ status: "closed", closedCount: 0 });
  });
});

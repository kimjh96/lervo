import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";
import { REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION } from "@lervo/repository-knowledge";
import { holdRepository, releaseRepositoryHold } from "@lervo/repository-registry";

import { convergenceSourceFingerprint } from "../src/source-fingerprint.js";
import { writeResidentCycleState } from "../src/resident-cycle-state.js";
import { recordKnowledgeResidentHealth } from "../src/resident-health.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { clearOfFenceTimeWindowBoundary, fixture } from "./fixture.js";

const execute = promisify(execFile);
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function observer(f: Awaited<ReturnType<typeof fixture>>) {
  // Each comparison spans real time, and the fence changes at every 30-minute window boundary.
  await clearOfFenceTimeWindowBoundary();
  const observe = () =>
    convergenceSourceFingerprint({ repositoryRoot: f.root, events: f.events }).fingerprint;
  let last = observe();
  return {
    unchanged: (label: string) => expect(observe(), label).toBe(last),
    changed: async (label: string, mutate: () => Promise<unknown>) => {
      await mutate();
      const next = observe();
      expect(next, label).not.toBe(last);
      last = next;
      expect(observe(), `${label} is stable`).toBe(last);
    },
  };
}

it("changes for every repository, policy, delegation and candidate input and nothing else", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const fence = await observer(f);
  fence.unchanged("untouched tree");
  await writeResidentCycleState(f.root, {
    schemaVersion: 1,
    fingerprint: null,
    lastCycleAt: null,
    lastResult: "idle",
    idleStreak: 0,
    nextReconcileAt: null,
  });
  await recordKnowledgeResidentHealth({ repositoryRoot: f.root, workerId: "w", state: "idle" });
  fence.unchanged("private resident state");
  const git = (...args: string[]) =>
    execute("git", [
      "-C",
      f.root,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@lervo.invalid",
      ...args,
    ]);
  await fence.changed("tracked edit", () =>
    writeFile(resolve(f.root, "README.md"), "# Repository\n\nChanged once.\n"),
  );
  await fence.changed("second edit of a dirty file with the same size", () =>
    writeFile(resolve(f.root, "README.md"), "# Repository\n\nChanged twice\n"),
  );
  await fence.changed("untracked file", () =>
    writeFile(resolve(f.root, "docs/specs/new.md"), "# New\n"),
  );
  await fence.changed("deleted file", () => rm(resolve(f.root, "docs/specs/runtime.md")));
  await fence.changed("commit", async () => {
    await git("add", "-A");
    await git("commit", "-m", "change");
  });
  await fence.changed("policy edit", () =>
    writeFile(
      resolve(f.root, ".lervo/knowledge/policy.yaml"),
      JSON.stringify({ exclude: ["vendor/**"] }),
    ),
  );
  await fence.changed("delegation edit", () =>
    writeFile(
      resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
      JSON.stringify(f.delegation, null, 2),
    ),
  );
  const shard = resolve(f.root, ".lervo/state/knowledge/canonicalization-candidates/ab");
  await fence.changed("candidate shard", () => mkdir(shard, { recursive: true }));
  await fence.changed("candidate entry", () =>
    writeFile(resolve(shard, `kcanon_${"a".repeat(24)}.json`), "{}"),
  );
  await fence.changed("candidate rewrite", () =>
    writeFile(resolve(shard, `kcanon_${"a".repeat(24)}.json`), '{"x":1}'),
  );
  const freshness = resolve(f.root, ".lervo/state/knowledge");
  const cycle = (findingsDigest: string, lastCycleAt: string) =>
    writeFile(
      resolve(freshness, "freshness-cycle.json"),
      JSON.stringify({ schemaVersion: 1, findingsDigest, lastCycleAt }),
    );
  await fence.changed("freshness findings digest", () => cycle(`sha256:${"1".repeat(64)}`, "a"));
  await cycle(`sha256:${"1".repeat(64)}`, "b");
  fence.unchanged("freshness cycle bookkeeping without new findings");
  await fence.changed("freshness hold", async () => {
    await mkdir(resolve(freshness, "freshness-holds"), { recursive: true });
    await writeFile(resolve(freshness, "freshness-holds", `${"2".repeat(32)}.json`), "{}");
  });
  await fence.changed("freshness candidate", async () => {
    await mkdir(resolve(freshness, "freshness-candidates/ab"), { recursive: true });
    await writeFile(
      resolve(freshness, `freshness-candidates/ab/kfresh_ab${"0".repeat(22)}.json`),
      "{}",
    );
  });
});

it("changes for new canonical events and outbox work, and reports due deliveries", async () => {
  const f = await fixture();
  fixtures.push(f);
  const fence = await observer(f);
  await fence.changed("new event", () =>
    runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "fixture",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    }),
  );
  expect(
    convergenceSourceFingerprint({ repositoryRoot: f.root, events: f.events }).earliestAvailableAt,
  ).toBeNull();
  const event = f.events.latest()!;
  await fence.changed("outbox change", async () =>
    f.events.enqueue({
      eventId: event.eventId,
      destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
      enqueuedAt: new Date().toISOString(),
    }),
  );
  const observed = convergenceSourceFingerprint({ repositoryRoot: f.root, events: f.events });
  expect(observed.earliestAvailableAt).toBeLessThanOrEqual(Date.now());
});

it("fails instead of observing a repository without a head", async () => {
  const f = await fixture();
  fixtures.push(f);
  await rm(resolve(f.root, ".git"), { recursive: true, force: true });
  await execute("git", ["-C", f.root, "init", "-b", "main"]);
  expect(() =>
    convergenceSourceFingerprint({ repositoryRoot: f.root, events: f.events }),
  ).toThrow();
});

it("changes when the owner holds or releases a repository (ADR-0595)", async () => {
  const previous = process.env.LERVO_USER_STATE_DIRECTORY;
  const state = await mkdtemp(resolve(tmpdir(), "lervo-fence-hold-state-"));
  process.env.LERVO_USER_STATE_DIRECTORY = state;
  try {
    const f = await fixture();
    fixtures.push(f);
    const fence = await observer(f);
    // A held resident backs off and skips; only this change lets a release run it in full.
    await fence.changed("hold", () => holdRepository({ repositoryRoot: f.root, reason: null }));
    fence.unchanged("held tree");
    await fence.changed("release", () => releaseRepositoryHold({ repositoryRoot: f.root }));
  } finally {
    if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
    else process.env.LERVO_USER_STATE_DIRECTORY = previous;
    await rm(state, { recursive: true, force: true });
  }
});

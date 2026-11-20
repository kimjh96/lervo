import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  hubKnowledgeChangeRetryDelay,
  watchHubKnowledgeChanges,
  type KnowledgeHubChangeTransport,
} from "../src/hub-knowledge-changes.js";
import { watchFiles } from "../src/resident-file-watch.js";
import { writeHostConfig } from "./convergence-owner-hosts.js";

let root: string;
let storage: ProjectStorage;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-hub-changes-"));
  storage = {
    paths: { repositoryRoot: root },
    manifest: {
      schemaVersion: 1,
      projectId: "prj_hub_changes",
      name: "hub-changes",
      root: ".",
      createdAt: "2026-11-20T00:00:00.000Z",
      dataPolicy: {},
    },
  } as unknown as ProjectStorage;
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

/** A scripted Hub: each wait takes the next answer, or holds until `answer` or abort. */
function scriptedHub() {
  const waits: { cursor: string | null; hostHash: string | null }[] = [];
  let release: ((outcome: { cursor: string } | Error) => void) | null = null;
  const transport: KnowledgeHubChangeTransport = async () => ({
    wait: ({ cursor, hostHash, signal }) =>
      new Promise((resolveWait, rejectWait) => {
        waits.push({ cursor, hostHash });
        release = (outcome) => {
          release = null;
          if (outcome instanceof Error) rejectWait(outcome);
          else resolveWait(outcome);
        };
        signal.addEventListener("abort", () => rejectWait(signal.reason), { once: true });
      }),
  });
  return {
    transport,
    waits,
    answer: async (outcome: { cursor: string } | Error) => {
      await vi.waitFor(() => expect(release).not.toBeNull());
      release!(outcome);
    },
  };
}

const cursor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("waits for nothing while standalone or without a transport", async () => {
  const none = watchHubKnowledgeChanges({ storage, transport: undefined, onChange: vi.fn() });
  await none.ready();
  expect(none.token()).toBeNull();
  await none.stop();
  await writeHostConfig(root, {
    hostId: `hst_${"1".repeat(32)}`,
    label: "mac",
    mode: "standalone",
  });
  const hub = scriptedHub();
  const standalone = watchHubKnowledgeChanges({
    storage,
    transport: hub.transport,
    onChange: vi.fn(),
  });
  await standalone.ready();
  expect(hub.waits).toEqual([]);
  await standalone.stop();
});

it("primes the first token silently, then reports each change and keeps the cursor across a failure", async () => {
  await writeHostConfig(root, { hostId: `hst_${"1".repeat(32)}`, label: "mac", mode: "hub" });
  const hub = scriptedHub();
  const onChange = vi.fn();
  const issues: (string | null)[] = [];
  const watch = watchHubKnowledgeChanges({
    storage,
    transport: hub.transport,
    onChange,
    onIssue: (issue) => issues.push(issue),
    retry: { baseMilliseconds: 10, ceilingMilliseconds: 40 },
  });
  try {
    await hub.answer({ cursor: cursor(1) });
    await watch.ready();
    expect(watch.token()).toBe(cursor(1));
    expect(onChange).not.toHaveBeenCalled();
    await hub.answer({ cursor: cursor(2) });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(watch.token()).toBe(cursor(2));
    // The Hub drops the connection: attention, then the same cursor again after the backoff.
    await hub.answer(new Error("socket hang up"));
    await vi.waitFor(() => expect(issues).toEqual(["hub_knowledge_changes_unavailable"]));
    await vi.waitFor(() => expect(hub.waits.at(-1)).toMatchObject({ cursor: cursor(2) }));
    await hub.answer({ cursor: cursor(2) });
    await vi.waitFor(() => expect(issues).toEqual(["hub_knowledge_changes_unavailable", null]));
    // Reconnecting to the same Hub process is no change.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(hub.waits.every((wait) => wait.hostHash?.startsWith("sha256:"))).toBe(true);
  } finally {
    await watch.stop();
  }
});

it("reconnects at once when the owner-host coordinates change", { timeout: 20_000 }, async () => {
  await writeHostConfig(root, {
    hostId: `hst_${"1".repeat(32)}`,
    label: "mac",
    mode: "standalone",
  });
  const hub = scriptedHub();
  const onChange = vi.fn();
  const watch = watchHubKnowledgeChanges({ storage, transport: hub.transport, onChange });
  try {
    await watch.ready();
    expect(hub.waits).toEqual([]);
    // The file watch is a detector, so rewrite until it is seen.
    await vi.waitFor(
      async () => {
        await writeHostConfig(root, { hostId: `hst_${"1".repeat(32)}`, label: "mac", mode: "hub" });
        expect(hub.waits.length).toBeGreaterThan(0);
      },
      { timeout: 15_000, interval: 200 },
    );
    expect(hub.waits[0]).toMatchObject({ cursor: null });
  } finally {
    await watch.stop();
  }
});

it("backs a failing wait off exponentially to its ceiling", () => {
  expect([1, 2, 3, 4, 20].map((failures) => hubKnowledgeChangeRetryDelay(failures))).toEqual([
    1_000, 2_000, 4_000, 8_000, 300_000,
  ]);
});

it(
  "covers a missing directory from its nearest ancestor and notifies once it appears",
  { timeout: 20_000 },
  async () => {
    const target = resolve(root, "a/b/c/file.json");
    const notify = vi.fn();
    const watch = watchFiles([target], notify);
    try {
      expect(watch.unwatched).toEqual([]);
      await mkdir(resolve(root, "a/b/c"), { recursive: true });
      await vi.waitFor(
        async () => {
          await writeFile(target, `${Date.now()}\n`);
          expect(notify).toHaveBeenCalled();
        },
        { timeout: 15_000, interval: 200 },
      );
    } finally {
      watch.stop();
    }
  },
);

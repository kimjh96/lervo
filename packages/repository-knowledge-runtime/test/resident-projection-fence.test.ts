import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { holdRepository, releaseRepositoryHold } from "@lervo/repository-registry";
import type { OutboxStore } from "@lervo/storage-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONVERGENCE_OWNER_FENCE_PATH } from "../src/convergence-owner-fence.js";
import {
  RESIDENT_HELD_PROJECTION_MAXIMUM_AGE_MILLISECONDS as HELD_MAXIMUM_AGE,
  RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS as MAXIMUM_AGE,
  residentProjectionDue,
  residentProjectionRefresher,
  residentProjectionRetryDelay,
} from "../src/resident-projection-fence.js";

const execute = promisify(execFile);
const MINUTE = 60_000;
const git = (...args: string[]) =>
  execute("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@lervo.invalid", ...args]);
const previousState = process.env.LERVO_USER_STATE_DIRECTORY;
let directory: string;
let root: string;

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "lervo-projection-fence-"));
  root = resolve(directory, "repository");
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  // The host hold store must never be the developer's own.
  process.env.LERVO_USER_STATE_DIRECTORY = resolve(directory, "user-state");
  await git("init", "-b", "main");
  await writeFile(resolve(root, ".gitignore"), ".lervo/state/\n");
  await writeFile(resolve(root, "README.md"), "# Repository\n");
  await git("add", "-A");
  await git("commit", "-m", "initial");
});

afterEach(async () => {
  if (previousState === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previousState;
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A resident's projection offers on a virtual clock, counting the refreshes that ran. */
function resident(options: { failRefresh?: () => boolean } = {}) {
  const state = {
    now: 0,
    held: false,
    head: "evt_1" as string | null,
    eventsFail: false,
    refreshes: 0,
  };
  const events = {
    // ADR-0597: the key reads only the head hash; decoding the latest event is never needed.
    latest: () => {
      throw new Error("the projection key must not decode the latest event");
    },
    latestHash: () => {
      if (state.eventsFail) throw new Error("event store unreadable");
      return state.head;
    },
  } as unknown as OutboxStore;
  const offer = residentProjectionRefresher({
    repositoryRoot: root,
    events,
    enabled: true,
    signal: new AbortController().signal,
    refresh: async () => {
      state.refreshes += 1;
      return options.failRefresh?.() !== true;
    },
    residentState: () => "idle\0source_unchanged",
    held: () => state.held,
    maximumAgeMilliseconds: MAXIMUM_AGE,
    now: () => state.now,
  });
  /** One check tick a minute later. */
  const tick = async (ageOnly = false) => {
    state.now += MINUTE;
    await offer({ ageOnly });
  };
  return { state, offer, tick };
}

describe("projection fence (ADR-0595)", () => {
  it("skips unchanged inputs and refreshes once the maximum age passes", async () => {
    const r = resident();
    await r.offer();
    expect(r.state.refreshes).toBe(1);
    for (let index = 0; index < 10; index++) await r.tick();
    expect(r.state.refreshes).toBe(1);
    while (r.state.now < MAXIMUM_AGE) await r.tick();
    expect(r.state.now).toBe(MAXIMUM_AGE);
    expect(r.state.refreshes).toBe(2);
    await r.tick();
    expect(r.state.refreshes).toBe(2);
  });

  it("refreshes once after an event append, a state rewrite, a commit or an owner change", async () => {
    const r = resident();
    await r.offer();
    const once = async (label: string, change: () => Promise<unknown> | void) => {
      const before = r.state.refreshes;
      await change();
      await r.tick();
      expect(r.state.refreshes, label).toBe(before + 1);
      await r.tick();
      expect(r.state.refreshes, `${label} is stable`).toBe(before + 1);
    };
    await once("event append", () => {
      r.state.head = "evt_2";
    });
    await once("state rewrite", () =>
      writeFile(
        resolve(root, ".lervo/state/knowledge/freshness-cycle.json"),
        '{"schemaVersion":1}\n',
      ),
    );
    // ADR-0597: a working-tree edit alone is left to the maximum age; staging or committing it
    // moves the index or HEAD, which the key reads from file metadata without a Git process.
    await writeFile(resolve(root, "README.md"), "# Repository\n\nEdited.\n");
    const unstaged = r.state.refreshes;
    await r.tick();
    expect(r.state.refreshes, "working-tree edit").toBe(unstaged);
    await once("staging", () => git("add", "README.md"));
    await once("commit", () => git("commit", "-m", "edit"));
    const fence = (role: string, observedAt: string) =>
      writeFile(
        resolve(root, CONVERGENCE_OWNER_FENCE_PATH),
        JSON.stringify({
          schemaVersion: 1,
          verdict: { role, holder: { label: "mac", hostHash: "h" }, observedAt },
          recordedHolderKey: null,
        }),
      );
    await once("owner fence", () => fence("owner", "2026-11-19T00:00:00.000Z"));
    // Every ownership observation rewrites the fence; only the shown role and holder count.
    await fence("owner", "2026-11-19T00:01:00.000Z");
    const before = r.state.refreshes;
    await r.tick();
    expect(r.state.refreshes).toBe(before);
    await once("owner role change", () => fence("waiting_owner", "2026-11-19T00:02:00.000Z"));
  });

  it("refreshes whenever the key cannot be read", async () => {
    const r = resident();
    await r.offer();
    r.state.eventsFail = true;
    await r.tick();
    await r.tick();
    expect(r.state.refreshes).toBe(3);
    r.state.eventsFail = false;
    await r.tick();
    expect(r.state.refreshes).toBe(4);
    await r.tick();
    expect(r.state.refreshes).toBe(4);
  });

  it("backs a failing refresh off from one minute to fifteen (ADR-0597)", async () => {
    const r = resident({ failRefresh: () => true });
    await r.offer();
    while (r.state.now < 60 * MINUTE) await r.tick();
    // Attempts at 0, 1, 3, 7, 15, 30, 45 and 60 minutes, instead of one every minute.
    expect(r.state.refreshes).toBe(8);
    expect([1, 2, 3, 4, 5, 6].map(residentProjectionRetryDelay)).toEqual(
      [1, 2, 4, 8, 15, 15].map((minutes) => minutes * MINUTE),
    );
    expect(residentProjectionRetryDelay(0)).toBe(0);
  });

  it("retries a refresh that failed instead of recording it", async () => {
    let fail = true;
    const r = resident({ failRefresh: () => fail });
    await r.offer();
    await r.tick();
    expect(r.state.refreshes).toBe(2);
    fail = false;
    await r.tick();
    await r.tick();
    expect(r.state.refreshes).toBe(3);
  });

  it("refreshes a held repository when held, then hourly, and again on release", async () => {
    const r = resident();
    await r.offer();
    await holdRepository({ repositoryRoot: root, reason: null });
    r.state.held = true;
    await r.tick();
    expect(r.state.refreshes).toBe(2);
    const heldAt = r.state.now;
    // Neither new events nor the 15-minute bound refresh a held repository.
    r.state.head = "evt_held";
    while (r.state.now < heldAt + HELD_MAXIMUM_AGE - MINUTE) await r.tick();
    expect(r.state.refreshes).toBe(2);
    // The hourly bound keeps its Node, replica and attention lines from going stale forever.
    await r.tick();
    expect(r.state.refreshes).toBe(3);
    await r.tick();
    expect(r.state.refreshes).toBe(3);
    await releaseRepositoryHold({ repositoryRoot: root });
    r.state.held = false;
    await r.tick();
    expect(r.state.refreshes).toBe(4);
  });

  it("applies only the age bound to a tick during a running cycle", async () => {
    const r = resident();
    await r.offer();
    r.state.head = "evt_2";
    await r.tick(true);
    expect(r.state.refreshes).toBe(1);
    // The cycle's own offer afterwards sees the change.
    await r.offer();
    expect(r.state.refreshes).toBe(2);
    while (r.state.now < 2 * MAXIMUM_AGE) await r.tick(true);
    expect(r.state.refreshes).toBe(3);
  });

  it("decides due refreshes from the key, the age and the hold", () => {
    const last = { key: "k", at: 0, held: false };
    const due = (input: Partial<Parameters<typeof residentProjectionDue>[0]>) =>
      residentProjectionDue({
        key: "k",
        last,
        now: MINUTE,
        held: false,
        maximumAgeMilliseconds: MAXIMUM_AGE,
        ...input,
      });
    expect(due({})).toBe(false);
    expect(due({ key: "other" })).toBe(true);
    expect(due({ key: null })).toBe(true);
    expect(due({ last: null })).toBe(true);
    expect(due({ now: MAXIMUM_AGE })).toBe(true);
    expect(due({ held: true })).toBe(true);
    expect(due({ held: true, last: { ...last, held: true }, now: HELD_MAXIMUM_AGE - 1 })).toBe(
      false,
    );
    expect(due({ held: true, last: { ...last, held: true }, now: HELD_MAXIMUM_AGE })).toBe(true);
    expect(due({ ageOnly: true, key: "other" })).toBe(false);
    expect(due({ ageOnly: true, now: MAXIMUM_AGE })).toBe(true);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ConvergenceContinuity } from "../src/convergence-continuity.js";
import type { ConvergenceOwnership } from "../src/convergence-owner.js";
import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import type { KnowledgeHubChangeTransport } from "../src/hub-knowledge-changes.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { runResidentCycle } from "../src/resident-cycle.js";
import { writeHostConfig } from "./convergence-owner-hosts.js";

vi.mock("../src/resident-cycle.js", async (original) => ({
  ...(await original<typeof import("../src/resident-cycle.js")>()),
  runResidentCycle: vi.fn(),
}));
vi.mock("@lervo/repository-registry", async (original) => ({
  ...(await original<typeof import("@lervo/repository-registry")>()),
  readRepositoryHold: vi.fn(async () => null),
}));
vi.mock("../src/resident-health.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/resident-health.js")>()),
  recordKnowledgeResidentHealth: vi.fn(async () => ({ earlierWriters: false })),
}));
vi.mock("../src/resident-cycle-state.js", () => ({
  readResidentCycleState: vi.fn(async () => null),
  writeResidentCycleState: vi.fn(async () => undefined),
}));

let root: string;
const savedUserState = process.env.LERVO_USER_STATE_DIRECTORY;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lervo-owner-deadline-"));
  process.env.LERVO_USER_STATE_DIRECTORY = join(root, "user-state");
  vi.mocked(runResidentCycle).mockImplementation(async () => ({
    state: {
      schemaVersion: 1,
      fingerprint: null,
      lastCycleAt: new Date().toISOString(),
      lastResult: "idle",
      idleStreak: 1,
      nextReconcileAt: null,
    },
    earliestAvailableAt: null,
    observedAt: Date.now(),
    outcome: { kind: "skipped" },
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  if (savedUserState === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = savedUserState;
  rmSync(root, { recursive: true, force: true });
});

function verdict(
  role: ConvergenceOwnerVerdict["role"],
  mode: ConvergenceOwnerVerdict["mode"],
): ConvergenceOwnerVerdict {
  const now = Date.now();
  return {
    role,
    reason: role === "owner" ? "lease_granted" : "lease_held_elsewhere",
    mode,
    hostHash: `sha256:${"a".repeat(64)}`,
    hostLabel: "mac",
    holder: null,
    validUntil:
      role === "owner" && mode === "hub" ? new Date(now + 25 * 60_000).toISOString() : null,
    wakeAt: null,
    grantedAt: null,
    yieldUntil: null,
    observedAt: new Date(now).toISOString(),
  } as ConvergenceOwnerVerdict;
}

function storage(): ProjectStorage {
  return {
    paths: { repositoryRoot: root },
    manifest: {
      schemaVersion: 1,
      projectId: "prj_owner_deadline",
      name: "owner-deadline",
      root: ".",
      createdAt: "2026-11-21T00:00:00.000Z",
      dataPolicy: {},
    },
  } as unknown as ProjectStorage;
}

/** Real turns only, so held sockets and file events settle while fake timers stay put. */
async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn++) await new Promise((settle) => setImmediate(settle));
}

/** A Hub that answers the first knowledge wait and holds every later one open. */
function pushingHub(): KnowledgeHubChangeTransport {
  let answered = false;
  return async () => ({
    wait: ({ signal }) =>
      new Promise((resolveWait, rejectWait) => {
        if (!answered) {
          answered = true;
          resolveWait({ cursor: "00000000-0000-4000-8000-000000000001" });
          return;
        }
        signal.addEventListener("abort", () => rejectWait(signal.reason), { once: true });
      }),
  });
}

it.each([
  ["a standalone owner", "standalone" as const],
  ["an owner on a Hub that pushes", "hub" as const],
])("arms no timer once %s is idle (ADR-0602)", async (_name, mode) => {
  await writeHostConfig(root, { hostId: `hst_${"1".repeat(32)}`, label: "mac", mode });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const observe = vi.fn(async () => verdict("owner", mode));
  const stop = startAutonomousKnowledgeWorker({
    storage: storage(),
    workerId: "resident",
    provider: "codex",
    subscribe: () => () => undefined,
    ownership: { observe } as unknown as ConvergenceOwnership,
    ...(mode === "hub" ? { hubChanges: pushingHub() } : {}),
    onFailure: vi.fn(),
  });
  try {
    // Due timers fire (the first cycle is one), but the clock does not move.
    for (let turn = 0; turn < 400 && vi.mocked(runResidentCycle).mock.calls.length === 0; turn++) {
      await vi.advanceTimersByTimeAsync(0);
      await turns(1);
    }
    await turns(50);
    expect(runResidentCycle).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    // No owner renewal, no reconcile, no poll: an idle owner waits on changes alone.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    await turns(20);
    expect(runResidentCycle).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
  } finally {
    await stop();
  }
});

it("turns continuity at once when this host takes over, with no poll while waiting (ADR-0478, ADR-0602)", async () => {
  await writeHostConfig(root, {
    hostId: `hst_${"1".repeat(32)}`,
    label: "mac",
    mode: "standalone",
  });
  const roles: ConvergenceOwnerVerdict["role"][] = ["waiting_owner", "owner"];
  const observe = vi.fn(async () => verdict(roles.shift() ?? "owner", "hub"));
  const turn = vi.fn(async (_input: { force?: boolean }) => ({
    status: "current" as const,
    state: null,
  }));
  let wake: () => void = () => undefined;
  const stop = startAutonomousKnowledgeWorker({
    storage: storage(),
    workerId: "resident",
    provider: "codex",
    subscribe: (notify) => {
      wake = notify;
      return () => undefined;
    },
    wakeDebounceMilliseconds: 1,
    ownership: { observe } as unknown as ConvergenceOwnership,
    continuity: { turn, inputPaths: () => [] } as unknown as ConvergenceContinuity,
    onFailure: vi.fn(),
  });
  try {
    await vi.waitFor(() => expect(runResidentCycle).toHaveBeenCalledTimes(1));
    expect(turn.mock.calls.every(([input]) => input.force !== true)).toBe(true);
    // The holder's release reaches this host as a change; its observation is the takeover.
    wake();
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(turn).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })),
    );
  } finally {
    await stop();
  }
});

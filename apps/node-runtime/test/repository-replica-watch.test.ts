import { afterEach, expect, it, vi } from "vitest";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";
import { watchReplicaReconciliation } from "../src/repository-replica-watch.js";
const callbacks = vi.hoisted(() => ({ local: () => {}, stop: vi.fn() }));
vi.mock("../src/repository-change-watch.js", () => ({
  watchRepositoryChanges: async (_root: string, notify: () => void) => {
    callbacks.local = notify;
    return callbacks.stop;
  },
}));

it("coalesces file and peer notifications, avoids idle snapshots, and closes both sources", async () => {
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  let remote = () => {};
  const stop = vi.fn();
  vi.spyOn(peer, "subscribe").mockImplementation((_root, notify) => {
    remote = notify;
    notify();
    return stop;
  });
  const abort = new AbortController();
  const reconcile = vi.fn(async (_repository: { replicaId: string }) => {});
  const running = watchReplicaReconciliation({
    repositories: [{ replicaId: "fixture", localRoot: "/fixture", peerRoot: "/peer" }],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 20; i++) {
      callbacks.local();
      remote();
    }
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reconcile).toHaveBeenCalledTimes(2);
  } finally {
    abort.abort();
    await running;
  }
  expect(stop).toHaveBeenCalledOnce();
  expect(callbacks.stop).toHaveBeenCalledOnce();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  callbacks.stop.mockClear();
});

it("does not let a busy peer postpone another repository's recovery sweep", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const signals = new Map<string, () => void>();
  vi.spyOn(peer, "subscribe").mockImplementation((root, notify) => {
    signals.set(root, notify);
    notify();
    return () => {};
  });
  const abort = new AbortController();
  const reconcile = vi.fn(async (_repository: { replicaId: string }) => {});
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "first", localRoot: "/first", peerRoot: "/peer/first" },
      { replicaId: "second", localRoot: "/second", peerRoot: "/peer/second" },
    ],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 10; i++) {
      signals.get("/peer/first")!();
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(
      reconcile.mock.calls.filter(([repository]) => repository.replicaId === "second").length,
    ).toBeGreaterThanOrEqual(2);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("does not let one slow repository block reconciliation for the others", async () => {
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  vi.spyOn(peer, "subscribe").mockImplementation((_root, notify) => {
    notify();
    return () => {};
  });
  const abort = new AbortController();
  let releaseFirst = () => {};
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const reconcile = vi.fn(async (repository: { replicaId: string }) => {
    if (repository.replicaId === "first") await firstBlocked;
  });
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "first", localRoot: "/first", peerRoot: "/peer/first" },
      { replicaId: "second", localRoot: "/second", peerRoot: "/peer/second" },
    ],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.waitFor(() =>
      expect(reconcile.mock.calls.map(([repository]) => repository.replicaId)).toEqual([
        "first",
        "second",
      ]),
    );
  } finally {
    releaseFirst();
    abort.abort();
    await running;
  }
});

it("honors a reduced reconciliation concurrency for constrained peer transports", async () => {
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  vi.spyOn(peer, "subscribe").mockImplementation((_root, notify) => {
    notify();
    return () => {};
  });
  const abort = new AbortController();
  let releaseFirst = () => {};
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const reconcile = vi.fn(async (repository: { replicaId: string }) => {
    if (repository.replicaId === "first") await firstBlocked;
  });
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "first", localRoot: "/first", peerRoot: "/peer/first" },
      { replicaId: "second", localRoot: "/second", peerRoot: "/peer/second" },
    ],
    peer,
    fallbackIntervalMs: 1_000,
    maximumConcurrency: 1,
    watch: true,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    expect(reconcile).toHaveBeenLastCalledWith(
      expect.objectContaining({ replicaId: "first" }),
      expect.objectContaining({ trigger: expect.any(String) }),
    );
    releaseFirst();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
    expect(reconcile).toHaveBeenLastCalledWith(
      expect.objectContaining({ replicaId: "second" }),
      expect.objectContaining({ trigger: expect.any(String) }),
    );
  } finally {
    releaseFirst();
    abort.abort();
    await running;
  }
});

it("starts a new hint when capacity is free without waiting for the active batch", async () => {
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const signals = new Map<string, () => void>();
  vi.spyOn(peer, "subscribe").mockImplementation((root, notify) => {
    signals.set(root, notify);
    notify();
    return () => {};
  });
  const abort = new AbortController();
  let releaseSlow = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const reconcile = vi.fn(async (repository: { replicaId: string }) => {
    if (repository.replicaId !== "fast") await slow;
  });
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "slow_a", localRoot: "/slow-a", peerRoot: "/peer/slow-a" },
      { replicaId: "slow_b", localRoot: "/slow-b", peerRoot: "/peer/slow-b" },
      { replicaId: "slow_c", localRoot: "/slow-c", peerRoot: "/peer/slow-c" },
      { replicaId: "fast", localRoot: "/fast", peerRoot: "/peer/fast" },
    ],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(4));
    signals.get("/peer/fast")!();
    await vi.waitFor(() =>
      expect(
        reconcile.mock.calls.filter(([repository]) => repository.replicaId === "fast"),
      ).toHaveLength(2),
    );
  } finally {
    releaseSlow();
    abort.abort();
    await running;
  }
});

it("polls with finite commands when persistent peer watches are disabled", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const subscribe = vi.spyOn(peer, "subscribe");
  const abort = new AbortController();
  const reconcile = vi.fn(async (_repository: { replicaId: string }) => {});
  const running = watchReplicaReconciliation({
    repositories: [{ replicaId: "fixture", localRoot: "/fixture", peerRoot: "/peer" }],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_250);
    expect(reconcile.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(subscribe).not.toHaveBeenCalled();
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("does not queue timer sweeps faster than a constrained bridge can finish them", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const abort = new AbortController();
  let release = () => {};
  let blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reconcile = vi.fn(async () => blocked);
  const running = watchReplicaReconciliation({
    repositories: [{ replicaId: "fixture", localRoot: "/fixture", peerRoot: "/peer" }],
    peer,
    fallbackIntervalMs: 1_000,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    reconcile,
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_250);
    expect(reconcile).toHaveBeenCalledTimes(2);
    blocked = Promise.resolve();
  } finally {
    release();
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("backs idle recovery off to its ceiling and returns to the base on a change", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const abort = new AbortController();
  const started = Date.now();
  const sweeps: Array<{ at: number; trigger: string }> = [];
  const intervals: number[] = [];
  let outcome: "current" | "not_current" = "current";
  const running = watchReplicaReconciliation({
    repositories: [{ replicaId: "fixture", localRoot: "/fixture", peerRoot: "/peer" }],
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 240_000,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    onRecoveryInterval: (intervalMs) => intervals.push(intervalMs),
    reconcile: async (_repository, { trigger }) => {
      sweeps.push({ at: Date.now() - started, trigger });
      return outcome;
    },
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000 + 60_000 + 120_000 + 240_000 + 240_000);
    expect(sweeps).toEqual([
      { at: 0, trigger: "recovery" },
      { at: 30_000, trigger: "recovery" },
      { at: 90_000, trigger: "recovery" },
      { at: 210_000, trigger: "recovery" },
      { at: 450_000, trigger: "recovery" },
      { at: 690_000, trigger: "recovery" },
    ]);
    expect(intervals).toEqual([30_000, 60_000, 120_000, 240_000, 240_000, 240_000]);

    // A local change reconciles promptly and returns the next sweep to the base interval.
    callbacks.local();
    await vi.advanceTimersByTimeAsync(250);
    expect(sweeps.at(-1)).toEqual({ at: 690_250, trigger: "change" });
    expect(intervals.at(-1)).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sweeps.at(-1)).toEqual({ at: 720_000, trigger: "recovery" });
    expect(intervals.at(-1)).toBe(60_000);

    // A non-current outcome returns the following sweeps to the base interval.
    outcome = "not_current";
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweeps.slice(-3).map((sweep) => sweep.at)).toEqual([780_000, 810_000, 840_000]);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

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
    expect(intervals.at(-1)).toBe(240_000);

    // A local change reconciles promptly; that replica's next sweep starts from the base again.
    callbacks.local();
    expect(intervals.at(-1)).toBe(30_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(sweeps.at(-1)).toEqual({ at: 690_250, trigger: "change" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sweeps.at(-1)).toEqual({ at: 720_250, trigger: "recovery" });

    // A non-current outcome keeps the following sweeps at the base interval.
    outcome = "not_current";
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweeps.slice(-3).map((sweep) => sweep.at)).toEqual([780_250, 810_250, 840_250]);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("backs a held replica off even while another replica keeps changing", async () => {
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
  const heldSweeps: number[] = [];
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "held", localRoot: "/held", peerRoot: "/peer/held" },
      // The mocked local watch notifies the last registered repository.
      { replicaId: "busy", localRoot: "/busy", peerRoot: "/peer/busy" },
    ],
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 600_000,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    reconcile: async (repository) => {
      if (repository.replicaId !== "held") return "not_current";
      heldSweeps.push(Date.now() - started);
      return "held";
    },
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    for (let elapsed = 0; elapsed < 3_600_000; elapsed += 20_000) {
      callbacks.local();
      await vi.advanceTimersByTimeAsync(20_000);
    }
    // ADR-0461 reset every replica to the base on any hint; now only the changed one resets.
    expect(heldSweeps).toEqual([
      0, 30_000, 90_000, 210_000, 450_000, 930_000, 1_530_000, 2_130_000, 2_730_000, 3_330_000,
    ]);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("probes an unreachable peer once per back-off period and resumes every replica", async () => {
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
  let down = true;
  const cycles: Array<{ at: number; replicaId: string }> = [];
  const probes: number[] = [];
  const states: Array<number | null> = [];
  const running = watchReplicaReconciliation({
    repositories: ["first", "second", "third"].map((replicaId) => ({
      replicaId,
      localRoot: `/${replicaId}`,
      peerRoot: `/peer/${replicaId}`,
    })),
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 240_000,
    maximumConcurrency: 1,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    probePeer: async () => {
      probes.push(Date.now() - started);
      return !down;
    },
    onPeerBackoff: (state) => states.push(state.retryAt === null ? null : state.retryAt - started),
    reconcile: async (repository) => {
      cycles.push({ at: Date.now() - started, replicaId: repository.replicaId });
      return down ? "peer_unreachable" : "current";
    },
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(cycles).toEqual([{ at: 0, replicaId: "first" }]);
    // Local changes during the outage wait for the peer instead of contacting it.
    for (let elapsed = 0; elapsed < 449_000; elapsed += 1_000) {
      callbacks.local();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(cycles).toHaveLength(1);
    expect(probes).toEqual([30_000, 90_000, 210_000]);
    expect(states.filter((state) => state !== null).at(-1)).toBe(450_000);

    down = false;
    await vi.advanceTimersByTimeAsync(1_000 + 1_000);
    expect(probes).toEqual([30_000, 90_000, 210_000, 450_000]);
    expect(states.at(-1)).toBeNull();
    expect(
      cycles
        .slice(1)
        .map((cycle) => cycle.replicaId)
        .sort(),
    ).toEqual(["first", "second", "third"]);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it.each([
  { concurrency: 4, failMs: 500 },
  { concurrency: 2, failMs: 500 },
  { concurrency: 1, failMs: 500 },
  { concurrency: 4, failMs: 60_000 },
  { concurrency: 1, failMs: 60_000 },
])(
  "keeps a replica whose own transport keeps failing on its own back-off ($concurrency, $failMs ms)",
  async ({ concurrency, failMs }) => {
    vi.useFakeTimers();
    const peer = new SshRepositoryReplicaPeer({
      executable: "ssh",
      arguments: [],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
    });
    const abort = new AbortController();
    const cycles: Record<string, number> = {};
    let probes = 0;
    let closures = 0;
    let closedSince: number | null = null;
    let closedMs = 0;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const running = watchReplicaReconciliation({
      repositories: ["broken", "a", "b", "c", "d"].map((replicaId) => ({
        replicaId,
        localRoot: `/${replicaId}`,
        peerRoot: `/peer/${replicaId}`,
      })),
      peer,
      fallbackIntervalMs: 30_000,
      idleRecoveryCeilingMs: 600_000,
      maximumConcurrency: concurrency,
      watch: true,
      peerWatch: false,
      signal: abort.signal,
      probePeer: async () => {
        probes += 1;
        await delay(300);
        return true;
      },
      onPeerBackoff: (state) => {
        if (state.retryAt !== null && closedSince === null) {
          closures += 1;
          closedSince = Date.now();
        } else if (state.retryAt === null && closedSince !== null) {
          closedMs += Date.now() - closedSince;
          closedSince = null;
        }
      },
      reconcile: async (repository) => {
        cycles[repository.replicaId] = (cycles[repository.replicaId] ?? 0) + 1;
        if (repository.replicaId === "broken") {
          await delay(failMs);
          return "peer_unreachable";
        }
        await delay(1_000);
        return "current";
      },
    });
    try {
      for (let minute = 0; minute < 60; minute += 1) await vi.advanceTimersByTimeAsync(60_000);
      // Before this rule: 3,601 broken and 1,800 sibling cycles an hour at concurrency 4, and
      // siblings stuck at 55 an hour at concurrency 1. An idle replica runs 10 in its first hour.
      expect(cycles.broken).toBeLessThanOrEqual(11);
      for (const sibling of ["a", "b", "c", "d"]) expect(cycles[sibling]).toBeLessThanOrEqual(10);
      // One gate probe, plus one confirming probe per failure after the replica was isolated.
      expect(probes).toBeLessThanOrEqual(cycles.broken!);
      expect(closures).toBe(1);
      expect(closedMs).toBeLessThanOrEqual(31_000);
    } finally {
      abort.abort();
      await vi.advanceTimersByTimeAsync(failMs);
      await running;
    }
  },
);

it("keeps scheduling a replica that was still running when the peer gate reopened", async () => {
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
  const slowRuns: number[] = [];
  let reopenedAt: number | null = null;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const running = watchReplicaReconciliation({
    repositories: [
      { replicaId: "fails", localRoot: "/fails", peerRoot: "/peer/fails" },
      { replicaId: "slow", localRoot: "/slow", peerRoot: "/peer/slow" },
    ],
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 600_000,
    maximumConcurrency: 2,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    probePeer: async () => true,
    onPeerBackoff: (state) => {
      if (state.retryAt === null && reopenedAt === null) reopenedAt = Date.now() - started;
    },
    reconcile: async (repository) => {
      if (repository.replicaId === "fails") {
        await delay(500);
        return "peer_unreachable";
      }
      slowRuns.push(Date.now() - started);
      await delay(40_000);
      return "current";
    },
  });
  try {
    await vi.advanceTimersByTimeAsync(200_000);
    // The probe reopened the gate at 30.5 s while `slow` was still running until 40 s.
    expect(reopenedAt).toBe(30_500);
    expect(slowRuns).toEqual([0, 70_000, 170_000]);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(40_000);
    await running;
  }
});

/** Five replicas against a peer that goes down; `d` is the one the mocked local watch notifies. */
async function outage(input: {
  concurrency: number;
  /** Replicas whose transport fails on their own while the peer is up. */
  broken: readonly string[];
  /** Probe results while the peer is down, in order; later probes fail. */
  flaps: readonly boolean[];
  upForMs: number;
  downForMs: number;
}) {
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
  let down = false;
  const flaps = [...input.flaps];
  const attempts: Record<string, number> = {};
  let probes = 0;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const running = watchReplicaReconciliation({
    repositories: ["a", "b", "c", "e", "d"].map((replicaId) => ({
      replicaId,
      localRoot: `/${replicaId}`,
      peerRoot: `/peer/${replicaId}`,
    })),
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 600_000,
    maximumConcurrency: input.concurrency,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    probePeer: async () => {
      if (down) probes += 1;
      await delay(300);
      return down ? (flaps.shift() ?? false) : true;
    },
    reconcile: async (repository) => {
      if (down) attempts[repository.replicaId] = (attempts[repository.replicaId] ?? 0) + 1;
      await delay(500);
      return down || input.broken.includes(repository.replicaId) ? "peer_unreachable" : "current";
    },
  });
  try {
    for (let elapsed = 0; elapsed < input.upForMs; elapsed += 1_000) {
      if (input.broken.includes("d")) callbacks.local();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    down = true;
    for (let elapsed = 0; elapsed < input.downForMs; elapsed += 1_000) {
      callbacks.local();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(Date.now() - started).toBe(input.upForMs + input.downForMs);
    return { attempts, probes };
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
  }
}

it("still closes the gate when a probe flap during an outage isolated every replica", async () => {
  // Round-2 review: `d` made 420 connection attempts in 449 s; the original incident made 494.
  const { attempts, probes } = await outage({
    concurrency: 5,
    broken: [],
    flaps: [true],
    upForMs: 60_000,
    downForMs: 449_000,
  });
  expect(attempts.d ?? 0).toBeLessThanOrEqual(5);
  expect(Object.values(attempts).reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(15);
  expect(probes).toBeLessThanOrEqual(10);
});

it("closes the gate on the first failure of a replica that was already isolated", async () => {
  // Round-2 review: `d` made 333 attempts in a 30-minute outage before another replica failed.
  const { attempts, probes } = await outage({
    concurrency: 1,
    broken: ["d"],
    flaps: [],
    upForMs: 120_000,
    downForMs: 1_800_000,
  });
  // A confirming probe answer is reused for up to one base interval (30 s), so the edits in that
  // window still reach the peer before the next probe closes the gate.
  expect(attempts.d ?? 0).toBeLessThanOrEqual(10);
  expect(Object.values(attempts).reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(15);
  // Confirmation probe plus the doubling retries: 30, 90, 210, 450, 930 and 1,530 seconds.
  expect(probes).toBeLessThanOrEqual(8);
});

it("gives a parked replica whose run was still finishing a follow-up when the gate reopens", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const abort = new AbortController();
  const cycles: Record<string, number> = {};
  let first = true;
  const running = watchReplicaReconciliation({
    repositories: ["big", "a", "b", "c", "d"].map((replicaId) => ({
      replicaId,
      localRoot: `/${replicaId}`,
      peerRoot: `/peer/${replicaId}`,
    })),
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 600_000,
    maximumConcurrency: 5,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    probePeer: async () => true,
    // Every cycle finishes in the same microtask drain, so siblings reopen the gate while `big`
    // is still active in the pool.
    reconcile: async (repository) => {
      cycles[repository.replicaId] = (cycles[repository.replicaId] ?? 0) + 1;
      if (repository.replicaId !== "big" || !first) return "current";
      first = false;
      return "peer_unreachable";
    },
  });
  try {
    for (let minute = 0; minute < 60; minute += 1) await vi.advanceTimersByTimeAsync(60_000);
    expect(cycles.big).toBeGreaterThanOrEqual(10);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

it("confirms an isolated replica's failures with at most one probe per base interval", async () => {
  vi.useFakeTimers();
  const peer = new SshRepositoryReplicaPeer({
    executable: "ssh",
    arguments: [],
    destination: "fixture",
    remoteNodeExecutable: "node",
    remoteRuntimeExecutable: "runtime",
  });
  const abort = new AbortController();
  let probes = 0;
  let cycles = 0;
  const running = watchReplicaReconciliation({
    // The mocked local watch notifies the last registered repository.
    repositories: ["a", "broken"].map((replicaId) => ({
      replicaId,
      localRoot: `/${replicaId}`,
      peerRoot: `/peer/${replicaId}`,
    })),
    peer,
    fallbackIntervalMs: 30_000,
    idleRecoveryCeilingMs: 600_000,
    watch: true,
    peerWatch: false,
    signal: abort.signal,
    probePeer: async () => {
      probes += 1;
      return true;
    },
    reconcile: async (repository) => {
      if (repository.replicaId !== "broken") return "current";
      cycles += 1;
      return "peer_unreachable";
    },
  });
  try {
    for (let elapsed = 0; elapsed < 3_600_000; elapsed += 1_000) {
      callbacks.local();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // Round-3 review: one confirming probe per edit made 3,562 probes in this hour.
    expect(cycles).toBeGreaterThan(3_000);
    expect(probes).toBeLessThanOrEqual(121);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await running;
  }
});

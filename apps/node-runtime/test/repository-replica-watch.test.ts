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

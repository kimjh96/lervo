import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { holdProcessPresence } from "@lervo/project-storage";
import { readRepositoryWatchIssues } from "@lervo/repository-knowledge-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { hostResidentCandidates } from "../src/knowledge-host-resident-candidates.js";
import { watchStandbyHolder } from "../src/knowledge-host-standby-watch.js";

vi.mock("../src/knowledge-host-resident-candidates.js", () => ({
  hostResidentCandidates: vi.fn(),
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-standby-watch-"));
  vi.clearAllMocks();
  vi.mocked(hostResidentCandidates).mockResolvedValue({
    wanted: new Map([[root, "codex"]]),
    nodeServed: [],
    notEnrolled: [],
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

it("raises repository attention for a lock holder this host cannot see, until the wait ends (ADR-0602)", async () => {
  const presence = holdProcessPresence();
  try {
    await presence.ready;
    // A holder in another namespace: its exit cannot be seen from here.
    const foreign = presence.token.replace(/[0-9a-f]{12}$/u, "000000000000");
    const onExit = vi.fn();
    const cancel = watchStandbyHolder({
      holderPresence: foreign,
      provider: "codex",
      onExit,
      onFailure: (error) => {
        throw error;
      },
    });
    await vi.waitFor(async () =>
      expect(await readRepositoryWatchIssues(root)).toEqual([
        expect.objectContaining({ code: "process_exit_wait_unavailable" }),
      ]),
    );
    expect(onExit).not.toHaveBeenCalled();
    cancel();
    await vi.waitFor(async () => expect(await readRepositoryWatchIssues(root)).toEqual([]));
  } finally {
    presence.release();
  }
});

it("raises nothing for a holder it can see, and rescans at its exit", async () => {
  const presence = holdProcessPresence();
  await presence.ready;
  const onExit = vi.fn();
  const cancel = watchStandbyHolder({
    holderPresence: presence.token,
    provider: "codex",
    onExit,
    onFailure: (error) => {
      throw error;
    },
  });
  try {
    presence.release();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(await readRepositoryWatchIssues(root)).toEqual([]);
    expect(hostResidentCandidates).not.toHaveBeenCalled();
  } finally {
    cancel();
  }
});

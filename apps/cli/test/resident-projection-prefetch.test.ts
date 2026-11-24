import { beforeEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  health: vi.fn(),
  snapshot: vi.fn(),
  cached: vi.fn(),
  head: vi.fn(),
}));
vi.mock("../src/repository-health-prefetch.js", () => ({
  prefetchRepositoryHealth: ports.health,
}));
vi.mock("../src/terminal-knowledge-snapshot.js", () => ({
  terminalKnowledgeSnapshotId: ports.snapshot,
  cachedKnowledgeSnapshotRevision: ports.cached,
}));
vi.mock("@lervo/repository-knowledge-runtime", () => ({
  repositoryHeadIdentity: ports.head,
}));

import { prefetchResidentProjections } from "../src/resident-projection-prefetch.js";

let root = 0;
let cache: string | null;
beforeEach(() => {
  root += 1;
  cache = "sha256:before-commit";
  ports.health.mockReset().mockResolvedValue("sha256:after-commit");
  ports.cached.mockReset().mockImplementation(async () => cache);
  ports.snapshot.mockReset().mockImplementation(async (_root: string, revision: string) => {
    cache = revision;
    return "ksnap_000000000000000000000000";
  });
  ports.head.mockReset().mockReturnValue({ head: "ref", ref: ["1", "1"], packedRefs: null });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("prefetches the prompt snapshot once a commit moved HEAD, reusing the health walk", async () => {
  const checkout = `/fixture-${root}`;
  await prefetchResidentProjections(checkout);
  await settle();
  expect(ports.snapshot).toHaveBeenCalledWith(checkout, "sha256:after-commit");
  // Nothing moved: no scan. An index rewrite alone (git status, git add) is no commit either.
  ports.head.mockReturnValue({ head: "ref", ref: ["1", "1"], packedRefs: null, index: ["9", "9"] });
  await prefetchResidentProjections(checkout);
  await settle();
  expect(ports.snapshot).toHaveBeenCalledTimes(1);
  ports.head.mockReturnValue({ head: "ref", ref: ["2", "2"], packedRefs: null });
  ports.health.mockResolvedValue("sha256:second-commit");
  await prefetchResidentProjections(checkout);
  await settle();
  expect(ports.snapshot).toHaveBeenCalledTimes(2);
});

it("tries again while a scan's result stayed out of the cache", async () => {
  const checkout = `/fixture-${root}`;
  // A concurrent edit keeps the scan's revision out of the cache.
  ports.snapshot.mockResolvedValueOnce("ksnap_000000000000000000000000");
  await prefetchResidentProjections(checkout);
  await settle();
  await prefetchResidentProjections(checkout);
  await settle();
  expect(ports.snapshot).toHaveBeenCalledTimes(2);
  await prefetchResidentProjections(checkout);
  await settle();
  expect(ports.snapshot).toHaveBeenCalledTimes(2);
});

it("skips a checkout never prompted, and one whose cache already holds the revision", async () => {
  cache = null;
  await prefetchResidentProjections(`/fixture-${root}`);
  cache = "sha256:after-commit";
  await prefetchResidentProjections(`/fixture-${root}-b`);
  await settle();
  expect(ports.snapshot).not.toHaveBeenCalled();
});

it("never waits for the scan and runs one at a time across checkouts", async () => {
  let finish!: () => void;
  ports.snapshot.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  await expect(prefetchResidentProjections(`/fixture-${root}`)).resolves.toBeUndefined();
  await prefetchResidentProjections(`/fixture-${root}-other`);
  expect(ports.snapshot).toHaveBeenCalledTimes(1);
  finish();
  await settle();
});

it("keeps a health failure visible and skips the scan without a readable HEAD", async () => {
  ports.health.mockRejectedValueOnce(new Error("health failed"));
  await expect(prefetchResidentProjections(`/fixture-${root}`)).rejects.toThrow("health failed");
  ports.head.mockImplementation(() => {
    throw new Error("no git directory");
  });
  await prefetchResidentProjections(`/fixture-${root}`);
  await settle();
  expect(ports.snapshot).not.toHaveBeenCalled();
});

import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan, resolveProjectPaths } from "@lervo/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireInitializationLock } from "../src/coordination-initialization-lock.js";
import { coordinationMarkerFor, readCoordinationMarker } from "../src/coordination-marker.js";
import { resolveRepositoryCoordinationHome } from "../src/index.js";

vi.mock("../src/coordination-initialization-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/coordination-initialization-lock.js")>();
  return { ...actual, acquireInitializationLock: vi.fn(actual.acquireInitializationLock) };
});
vi.mock("../src/coordination-marker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/coordination-marker.js")>();
  return {
    ...actual,
    coordinationMarkerFor: vi.fn(actual.coordinationMarkerFor),
    readCoordinationMarker: vi.fn(actual.readCoordinationMarker),
  };
});

const execute = promisify(execFile);
const temporaryRoots: string[] = [];
const lockCalls = () => vi.mocked(acquireInitializationLock).mock.calls.length;
const markerCalls = () => vi.mocked(coordinationMarkerFor).mock.calls.length;

// Any GIT_* variable disables coordinate reuse, so tests run without the caller's overrides.
let gitEnvironment: [string, string | undefined][] = [];
beforeEach(() => {
  gitEnvironment = Object.entries(process.env).filter(([name]) => name.startsWith("GIT_"));
  for (const [name] of gitEnvironment) delete process.env[name];
});
afterEach(async () => {
  for (const [name, value] of gitEnvironment) process.env[name] = value;
  vi.mocked(acquireInitializationLock).mockClear();
  vi.mocked(coordinationMarkerFor).mockClear();
  vi.mocked(readCoordinationMarker).mockClear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-coordination-memo-"));
  temporaryRoots.push(root);
  return root;
}

async function gitRepository(): Promise<string> {
  const root = await temporaryDirectory();
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));
  await execute("git", ["-C", root, "init"]);
  return root;
}

async function mode(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o7777;
}

/** Resolves read-only, which bypasses the home memo, so only the Git coordinate reuse is tested. */
function inspect(root: string) {
  return resolveRepositoryCoordinationHome(root, { readOnly: true });
}

/** Asserts that resolution asks Git again: without Git on PATH it falls back and is rejected. */
async function asksGit(root: string) {
  await withoutGit(() =>
    expect(inspect(root)).rejects.toMatchObject({ code: "coordination_home_invalid" }),
  );
}

/** Asserts that resolution reuses the remembered coordinates even without Git on PATH. */
async function reusesCoordinates(root: string, home: unknown) {
  await withoutGit(() => expect(inspect(root)).resolves.toEqual(home));
}

/** Runs `operation` with a PATH that cannot reach Git, so any Git observation fails. */
async function withoutGit<T>(operation: () => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = await temporaryDirectory();
  try {
    return await operation();
  } finally {
    process.env.PATH = path;
  }
}

describe("remembered coordination homes", () => {
  it("reuses a fully initialized home without its lock, marker write, or migration", async () => {
    const root = await gitRepository();
    const home = await resolveRepositoryCoordinationHome(root);
    expect([lockCalls(), markerCalls()]).toEqual([1, 1]);

    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
    expect([lockCalls(), markerCalls()]).toEqual([1, 1]);
  });

  it("serializes concurrent first initializations on the lock", async () => {
    const root = await gitRepository();
    // Hold the first initialization inside the lock until the other two callers reach it. A caller
    // that started after the first one finished would reuse its remembered home and skip the lock.
    const { acquireInitializationLock: acquire } = await vi.importActual<
      typeof import("../src/coordination-initialization-lock.js")
    >("../src/coordination-initialization-lock.js");
    vi.mocked(acquireInitializationLock).mockImplementationOnce(async (lockRoot) => {
      const release = await acquire(lockRoot);
      await vi.waitFor(() => expect(lockCalls()).toBe(3), { timeout: 5_000, interval: 5 });
      return release;
    });
    const homes = await Promise.all([0, 1, 2].map(() => resolveRepositoryCoordinationHome(root)));
    expect(lockCalls()).toBe(3);
    expect(new Set(homes.map((home) => home.repositoryInstanceId)).size).toBe(1);
  });

  it("repeats full initialization whenever it would repair, migrate, or reject", async () => {
    const root = await gitRepository();
    const home = await resolveRepositoryCoordinationHome(root);

    // A missing collection is created again.
    await rm(home.workspaces, { recursive: true });
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
    expect(await mode(home.workspaces)).toBe(0o700);
    expect(lockCalls()).toBe(2);

    // A group-writable collection is made private again.
    await chmod(home.events, 0o770);
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
    expect(await mode(home.events)).toBe(0o700);
    expect(lockCalls()).toBe(3);

    // Checkout-local workforce records are migrated exactly as on first initialization.
    const legacy = resolveProjectPaths(root).workforce;
    await mkdir(legacy, { recursive: true });
    await writeFile(resolve(legacy, "agents.json"), "legacy authority\n");
    await rm(home.workforce, { recursive: true });
    await mkdir(home.workforce, { mode: 0o700 });
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
    expect(await readFile(resolve(home.workforce, "agents.json"), "utf8")).toBe(
      "legacy authority\n",
    );
    await expect(lstat(legacy)).rejects.toMatchObject({ code: "ENOENT" });

    // An abandoned initialization lock is judged by the lock path again.
    const lock = resolve(home.root, ".initializing.lock");
    await writeFile(lock, "not-json\n", { mode: 0o600 });
    await utimes(lock, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
    await expect(resolveRepositoryCoordinationHome(root)).rejects.toMatchObject({
      code: "coordination_home_invalid",
    });
    await rm(lock);

    // A collection replaced by a symbolic link is rejected.
    const elsewhere = await temporaryDirectory();
    await rm(home.locks, { recursive: true });
    await symlink(elsewhere, home.locks);
    await expect(resolveRepositoryCoordinationHome(root)).rejects.toMatchObject({
      code: "coordination_home_invalid",
    });
    await rm(home.locks);

    // A deleted marker yields a new repository instance, as it always did.
    await rm(resolve(home.root, "repository.json"));
    const recreated = await resolveRepositoryCoordinationHome(root);
    expect(recreated.repositoryInstanceId).not.toBe(home.repositoryInstanceId);
    expect(recreated.root).toBe(home.root);
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(recreated);
  });

  it("falls through when an initializer takes the lock after the state was validated", async () => {
    const root = await gitRepository();
    const home = await resolveRepositoryCoordinationHome(root);
    const lock = resolve(home.root, ".initializing.lock");
    const actual = await vi.importActual<typeof import("../src/coordination-marker.js")>(
      "../src/coordination-marker.js",
    );
    // A peer takes the lock (here an abandoned, invalid one) right after the marker was read.
    vi.mocked(readCoordinationMarker).mockImplementationOnce(async (path, projectId) => {
      const marker = await actual.readCoordinationMarker(path, projectId);
      await writeFile(lock, "not-json\n", { mode: 0o600 });
      await utimes(lock, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
      return marker;
    });
    await expect(resolveRepositoryCoordinationHome(root)).rejects.toMatchObject({
      code: "coordination_home_invalid",
    });
    expect(lockCalls()).toBe(2);
    await rm(lock);
    await expect(resolveRepositoryCoordinationHome(root)).resolves.toEqual(home);
  });

  it.skipIf(process.platform === "win32")(
    "reuses plain-checkout Git coordinates only while their inputs are unchanged",
    async () => {
      const root = await gitRepository();
      const home = await resolveRepositoryCoordinationHome(root);
      await reusesCoordinates(root, home);

      await utimes(resolve(root, ".git/config"), new Date(), new Date("2001-01-01T00:00:00Z"));
      await asksGit(root);
      // The failed observation was not remembered: Git is asked again and the result is reused.
      await expect(inspect(root)).resolves.toEqual(home);
      await reusesCoordinates(root, home);
    },
  );

  it.skipIf(process.platform === "win32")(
    "asks Git again when the per-worktree configuration appears, changes, or disappears",
    async () => {
      const root = await gitRepository();
      const home = await resolveRepositoryCoordinationHome(root);
      const worktreeConfiguration = resolve(root, ".git/config.worktree");
      await writeFile(worktreeConfiguration, "[core]\n");
      await asksGit(root);
      await expect(inspect(root)).resolves.toEqual(home);
      await reusesCoordinates(root, home);

      await writeFile(worktreeConfiguration, "[core]\n\tbare = false\n");
      await asksGit(root);
      await expect(inspect(root)).resolves.toEqual(home);
      await rm(worktreeConfiguration);
      await asksGit(root);
    },
  );

  it.skipIf(process.platform === "win32")(
    "never reuses coordinates while any GIT_* variable is set",
    async () => {
      const root = await gitRepository();
      const home = await resolveRepositoryCoordinationHome(root);
      for (const [name, value] of [
        ["GIT_DIR", resolve(root, ".git")],
        ["GIT_CEILING_DIRECTORIES", "/"],
        ["GIT_CONFIG_COUNT", "0"],
      ] as const) {
        process.env[name] = value;
        try {
          await asksGit(root);
        } finally {
          delete process.env[name];
        }
        // The variable dropped the remembered coordinates; Git is asked once more.
        await expect(inspect(root)).resolves.toEqual(home);
        await reusesCoordinates(root, home);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "asks Git again once the repository is no longer one Git accepts",
    async () => {
      const root = await gitRepository();
      const home = await resolveRepositoryCoordinationHome(root);
      const head = resolve(root, ".git/HEAD");

      // A commit or checkout rewrites HEAD; a valid HEAD keeps the coordinates reusable.
      await writeFile(head, "ref: refs/heads/other\n");
      await reusesCoordinates(root, home);
      await writeFile(head, `${"a".repeat(40)}\n`);
      await reusesCoordinates(root, home);

      await writeFile(head, "not a reference\n");
      await asksGit(root);
      await writeFile(head, "ref: refs/heads/main\n");
      await expect(inspect(root)).resolves.toEqual(home);

      await rm(head);
      await asksGit(root);
      await writeFile(head, "ref: refs/heads/main\n");
      await expect(inspect(root)).resolves.toEqual(home);

      const refs = resolve(root, ".git/refs");
      const moved = resolve(root, ".git/refs-moved");
      await execute("mv", [refs, moved]);
      await symlink(moved, refs);
      await asksGit(root);
    },
  );

  it.skipIf(process.platform === "win32")("always asks Git for a linked worktree", async () => {
    const root = await gitRepository();
    await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
    await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
    await execute("git", ["-C", root, "add", "."]);
    await execute("git", ["-C", root, "commit", "-m", "fixture"]);
    const sibling = await temporaryDirectory();
    await rm(sibling, { recursive: true });
    await execute("git", ["-C", root, "worktree", "add", "--detach", sibling, "HEAD"]);
    const home = await resolveRepositoryCoordinationHome(sibling);
    await expect(resolveRepositoryCoordinationHome(sibling, { readOnly: true })).resolves.toEqual(
      home,
    );
    await withoutGit(() =>
      expect(resolveRepositoryCoordinationHome(sibling, { readOnly: true })).rejects.toMatchObject({
        code: "coordination_home_invalid",
      }),
    );
  });
});

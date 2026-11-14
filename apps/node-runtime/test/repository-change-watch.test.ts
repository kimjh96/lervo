import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";

const { watched, opened, closed } = vi.hoisted(() => ({
  watched: new Set<string>(),
  opened: [] as { directory: string; recursive: boolean }[],
  closed: [] as string[],
}));

// Recording which directories are watched proves the ignore boundary directly. Counting
// notifications cannot: one edit raises a variable number of native events, so an unchanged
// count only ever means the next one has not arrived yet.
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  const record = (directory: string, options: unknown, listener: unknown) => {
    const open = actual.watch as (
      path: string,
      options: unknown,
      listener: unknown,
    ) => ReturnType<typeof actual.watch>;
    const watcher = open(directory, options, listener);
    watched.add(directory);
    opened.push({ directory, recursive: (options as { recursive?: boolean }).recursive === true });
    const close = watcher.close.bind(watcher);
    watcher.close = () => {
      watched.delete(directory);
      closed.push(directory);
      close();
    };
    return watcher;
  };
  return { ...actual, default: actual, watch: record as unknown as typeof actual.watch };
});

const { watchRepositoryChanges } = await import("../src/repository-change-watch.js");
const execute = promisify(execFile);

const watchedUnder = (directory: string) =>
  [...watched].filter((path) => path === directory || path.startsWith(`${directory}${sep}`));

it("observes nested source edits and replica requests without watching ignored file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-watch-"));
  let stop: (() => void) | undefined;
  try {
    await execute("git", ["-C", root, "init"]);
    await mkdir(join(root, "source/nested"), { recursive: true });
    await mkdir(join(root, "cache"));
    await mkdir(join(root, ".lervo/state"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "cache/\n.lervo/state/\n");
    await writeFile(join(root, "source/nested/file.ts"), "first");
    await writeFile(join(root, "cache/file"), "first");
    const notify = vi.fn();
    stop = await watchRepositoryChanges(root, notify, notify, {
      recoveryIntervalMs: 1000,
      watchMode: "directories",
    });
    // Native watch registration can settle asynchronously; first observe a source hint.
    await vi.waitFor(
      async () => {
        await writeFile(join(root, "source/nested/file.ts"), "subscribed");
        expect(notify).toHaveBeenCalled();
      },
      { timeout: 10_000 },
    );
    // A rename naming a watched directory itself makes the watcher close and re-register it, so
    // being watched is transient and must be waited for. Never being watched is invariant: an
    // ignored directory is never put in the set at all, so sampling it at any instant is sound.
    await vi.waitFor(() => expect(watched.has(join(root, "source/nested"))).toBe(true), {
      timeout: 10_000,
    });
    expect(watchedUnder(join(root, "cache"))).toEqual([]);
    notify.mockClear();
    // A rename can close this directory's own watcher moments before the write, losing that one
    // notification for good, so repeat the stimulus inside the wait instead of writing once.
    await vi.waitFor(
      async () => {
        await writeFile(join(root, "source/nested/file.ts"), "second");
        expect(notify).toHaveBeenCalled();
      },
      { timeout: 10_000 },
    );
    // An ignored edit re-runs the tracked-path scan, which must not widen the watched set.
    await writeFile(join(root, "cache/file"), "second");
    notify.mockClear();
    await vi.waitFor(
      async () => {
        await writeFile(join(root, ".lervo/state/request.next"), "hint");
        await rename(
          join(root, ".lervo/state/request.next"),
          join(root, ".lervo/state/repository-replica-request.json"),
        );
        expect(notify).toHaveBeenCalled();
      },
      { timeout: 10_000 },
    );
    expect(watchedUnder(join(root, "cache"))).toEqual([]);
  } finally {
    stop?.();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

// Repeats the stimulus inside the wait: native registration settles asynchronously, so one write
// made before the watch is live would be lost for good.
const expectNotified = (notify: ReturnType<typeof vi.fn>, path: string) =>
  vi.waitFor(
    async () => {
      await writeFile(path, `${Date.now()}`);
      expect(notify).toHaveBeenCalled();
    },
    { timeout: 10_000 },
  );

it("keeps one recursive handle per repository while directories churn", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-watch-"));
  let stop: (() => void) | undefined;
  try {
    await execute("git", ["-C", root, "init"]);
    await mkdir(join(root, "source/nested"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "cache/\n");
    await writeFile(join(root, "source/nested/file.ts"), "first");
    const notify = vi.fn();
    opened.length = 0;
    closed.length = 0;
    stop = await watchRepositoryChanges(root, notify, notify, {
      // The metadata recovery timer would notify for any write; keep it out of the evidence.
      recoveryIntervalMs: 60_000,
      watchMode: "recursive",
    });
    await expectNotified(notify, join(root, "source/nested/file.ts"));
    expect(opened).toEqual([{ directory: root, recursive: true }]);
    // Each of these refreshed or reopened per-directory watches before; on macOS every reopen
    // rebuilt the shared FSEventStream and leaked memory per watched path.
    for (let index = 0; index < 40; index += 1) {
      await mkdir(join(root, `churn/${index}/deep`), { recursive: true });
      await writeFile(join(root, `churn/${index}/deep/file.ts`), "churn");
      await rename(join(root, `churn/${index}`), join(root, `churn/moved-${index}`));
      if (index % 2 === 0) await rm(join(root, `churn/moved-${index}`), { recursive: true });
      if (index % 10 === 0)
        await writeFile(join(root, ".gitignore"), `cache/\nignored-${index}/\n`);
    }
    // A directory created after startup notifies only once a refresh adds it to the filter set.
    await mkdir(join(root, "fresh/inner"), { recursive: true });
    notify.mockClear();
    await expectNotified(notify, join(root, "fresh/inner/file.ts"));
    expect(opened).toEqual([{ directory: root, recursive: true }]);
    expect(closed).toEqual([]);
  } finally {
    stop?.();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("watches a linked worktree and its outside common Git directory once each", async () => {
  const main = await mkdtemp(join(tmpdir(), "lervo-watch-main-"));
  const linked = `${main}-linked`;
  let stop: (() => void) | undefined;
  try {
    await execute("git", ["-C", main, "init"]);
    await writeFile(join(main, "tracked.ts"), "first");
    await execute("git", ["-C", main, "add", "tracked.ts"]);
    await execute("git", [
      "-C",
      main,
      "-c",
      "user.name=Lervo",
      "-c",
      "user.email=lervo@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);
    await execute("git", ["-C", main, "worktree", "add", "-q", linked]);
    const commonDirectory = resolve(
      linked,
      (await execute("git", ["-C", linked, "rev-parse", "--git-common-dir"])).stdout.trim(),
    );
    const notify = vi.fn();
    opened.length = 0;
    stop = await watchRepositoryChanges(linked, notify, notify, {
      recoveryIntervalMs: 60_000,
      watchMode: "recursive",
    });
    // The worktree's own Git directory lies inside the common directory, so it needs no handle.
    expect(opened).toEqual([
      { directory: linked, recursive: true },
      { directory: commonDirectory, recursive: true },
    ]);
    await expectNotified(notify, join(linked, "tracked.ts"));
    notify.mockClear();
    await vi.waitFor(
      async () => {
        await execute("git", ["-C", main, "branch", "-f", "observed"]);
        expect(notify).toHaveBeenCalled();
      },
      { timeout: 10_000 },
    );
  } finally {
    stop?.();
    await rm(linked, { recursive: true, force: true });
    await rm(main, { recursive: true, force: true });
  }
}, 30_000);

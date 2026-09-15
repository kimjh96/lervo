import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";

const { watched } = vi.hoisted(() => ({ watched: new Set<string>() }));

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
    const close = watcher.close.bind(watcher);
    watcher.close = () => {
      watched.delete(directory);
      close();
    };
    return watcher;
  };
  return { ...actual, default: actual, watch: record as unknown as typeof actual.watch };
});

const { watchRepositoryChanges } = await import("../src/repository-change-watch.js");

const watchedUnder = (directory: string) =>
  [...watched].filter((path) => path === directory || path.startsWith(`${directory}${sep}`));

it("observes nested source edits and replica requests without watching ignored file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-watch-"));
  const execute = promisify(execFile);
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
    stop = await watchRepositoryChanges(root, notify);
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

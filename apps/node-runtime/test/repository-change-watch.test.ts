import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { watchRepositoryChanges } from "../src/repository-change-watch.js";
import { settleRepositoryWatch } from "./repository-watch.fixture.js";

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
    await settleRepositoryWatch(notify);
    notify.mockClear();
    await writeFile(join(root, "source/nested/file.ts"), "second");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 10_000 });
    await settleRepositoryWatch(notify);
    notify.mockClear();
    await writeFile(join(root, "cache/file"), "second");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(notify).not.toHaveBeenCalled();
    await writeFile(join(root, ".lervo/state/request.next"), "hint");
    await rename(
      join(root, ".lervo/state/request.next"),
      join(root, ".lervo/state/repository-replica-request.json"),
    );
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 10_000 });
  } finally {
    stop?.();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

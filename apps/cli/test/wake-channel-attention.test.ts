import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryWatchReporter } from "@lervo/node-runtime";
import { afterEach, expect, it } from "vitest";

import { readWakeChannelAttention } from "../src/wake-channel-attention.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.skipIf(process.platform === "win32")(
  "turns a refused event channel and a lost repository watch into attention (ADR-0602)",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-wake-attention-"));
    roots.push(root);
    await mkdir(join(root, ".lervo/data"), { recursive: true });
    expect(await readWakeChannelAttention(root)).toEqual([]);
    await mkdir(join(root, ".lervo/run"), { recursive: true, mode: 0o700 });
    await symlink(tmpdir(), join(root, ".lervo/run/events.sqlite"));
    await repositoryWatchReporter(root).failed(
      Object.assign(new Error("watch"), { code: "EMFILE" }),
    );
    const issues = await readWakeChannelAttention(root);
    expect(issues.map((issue) => issue.code)).toEqual([
      "event_channel_refused",
      "repository_watch_unavailable",
    ]);
    expect(issues.every((issue) => issue.command.length > 0)).toBe(true);
  },
);

import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { processPresenceDirectory } from "@lervo/project-storage";
import { afterEach, beforeEach, expect, it } from "vitest";

import { heldRepositoryPresence } from "../src/held-presence.js";
import { readRepositoryWatchIssues } from "../src/repository-watch-state.js";

let root: string;
const created: string[] = [];
const savedUserState = process.env.LERVO_USER_STATE_DIRECTORY;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-held-presence-"));
  process.env.LERVO_USER_STATE_DIRECTORY = resolve(root, "user-state");
});
afterEach(async () => {
  if (savedUserState === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = savedUserState;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")(
  "records no token and reports attention when others can enter the presence directory (ADR-0602)",
  async () => {
    // A directory someone else prepared, readable by every user: a socket there proves nothing.
    // A deep state directory moves it under the home directory, so it is removed afterwards.
    const directory = processPresenceDirectory();
    created.push(directory);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o755);
    const held = heldRepositoryPresence(root);
    try {
      await expect(held.token()).resolves.toBeNull();
      expect(await readRepositoryWatchIssues(root)).toEqual([
        expect.objectContaining({ code: "process_presence_unavailable" }),
      ]);
    } finally {
      await held.release();
    }
    // Once released, the attention clears.
    expect(await readRepositoryWatchIssues(root)).toEqual([]);
  },
);

it.skipIf(process.platform === "win32")(
  "records the token once its socket listens in an owner-only directory (ADR-0602)",
  async () => {
    const held = heldRepositoryPresence(root);
    try {
      await expect(held.token()).resolves.toBe(held.presence.token);
      expect(await readRepositoryWatchIssues(root)).toEqual([]);
    } finally {
      await held.release();
    }
  },
);

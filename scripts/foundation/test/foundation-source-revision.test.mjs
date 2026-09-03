import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, it } from "vitest";

import { foundationSourceRevision } from "../evidence/source-revision.mjs";

const execute = promisify(execFile);

function expectedRevision(entries) {
  const hash = createHash("sha256");
  for (const [path, content] of entries) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

describe("foundation source revision", () => {
  it("excludes a tracked file deleted in the working tree", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "lervo-foundation-source-revision-"));
    try {
      await execute("git", ["init", "--quiet"], { cwd: repositoryRoot });
      await writeFile(join(repositoryRoot, "tracked.txt"), "tracked\n");
      await writeFile(join(repositoryRoot, "untracked.txt"), "untracked\n");
      await execute("git", ["add", "tracked.txt"], { cwd: repositoryRoot });
      await unlink(join(repositoryRoot, "tracked.txt"));

      assert.equal(
        await foundationSourceRevision(repositoryRoot),
        expectedRevision([["untracked.txt", "untracked\n"]]),
      );
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });
});

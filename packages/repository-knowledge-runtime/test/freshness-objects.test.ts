import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { freshnessObject, freshnessObjects } from "../src/freshness-git-evidence.js";

const roots: string[] = [];
const savedPath = process.env.PATH;
afterEach(async () => {
  process.env.PATH = savedPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-freshness-objects-"));
  roots.push(root);
  const git = (args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "a",
        GIT_AUTHOR_EMAIL: "a@b",
        GIT_COMMITTER_NAME: "a",
        GIT_COMMITTER_EMAIL: "a@b",
      },
    });
  git(["init", "--quiet", "-b", "main"]);
  await mkdir(resolve(root, "docs/sub"), { recursive: true });
  for (let index = 0; index < 50; index++)
    await writeFile(resolve(root, `docs/file-${index}.md`), `# ${index}\n`);
  await writeFile(resolve(root, "docs/sub/nested.md"), "# nested\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "seed"]);
  return root;
}

it.skipIf(process.platform === "win32")(
  "reads many objects in one Git process with the same answer as one path at a time (ADR-0606)",
  async () => {
    const root = await repository();
    const paths = [
      ...Array.from({ length: 50 }, (_, index) => `docs/file-${index}.md`),
      // A directory with a requested path inside it, and a path that does not exist.
      "docs",
      "docs/sub",
      "docs/sub/nested.md",
      "docs/missing.md",
    ];
    const expected = new Map<string, unknown>();
    for (const path of paths) expected.set(path, await freshnessObject(root, "HEAD", path));
    // Count the Git processes through a shim that logs each call before running Git.
    const shim = await mkdtemp(resolve(tmpdir(), "lervo-git-shim-"));
    roots.push(shim);
    const log = resolve(shim, "calls");
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    await writeFile(
      resolve(shim, "git"),
      `#!/bin/sh\necho call >> "${log}"\nexec "${real}" "$@"\n`,
    );
    await chmod(resolve(shim, "git"), 0o755);
    process.env.PATH = `${shim}${delimiter}${savedPath}`;
    const batched = await freshnessObjects(root, "HEAD", paths);
    const calls = (await readFile(log, "utf8")).split("\n").filter((line) => line !== "").length;
    // One process per nesting level, where one path per process would take 54.
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(3);
    expect(Object.fromEntries(batched)).toEqual(Object.fromEntries(expected));
    expect(batched.get("docs")).toMatchObject({ kind: "tree" });
    expect(batched.get("docs/missing.md")).toBeNull();
  },
);

it.skipIf(process.platform === "win32")(
  "refuses a symlink among the paths, as one path does",
  async () => {
    const root = await repository();
    await symlink("file-0.md", resolve(root, "docs/link.md"));
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=a",
      "-c",
      "user.email=a@b",
      "commit",
      "--quiet",
      "-m",
      "link",
    ]);
    await expect(freshnessObject(root, "HEAD", "docs/link.md")).rejects.toMatchObject({
      code: "freshness_evidence_unavailable",
    });
    await expect(
      freshnessObjects(root, "HEAD", ["docs/file-0.md", "docs/link.md"]),
    ).rejects.toMatchObject({
      code: "freshness_evidence_unavailable",
    });
  },
);

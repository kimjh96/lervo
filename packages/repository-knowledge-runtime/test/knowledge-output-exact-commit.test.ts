import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { KNOWLEDGE_OUTPUT_COMMIT_IDENTITY } from "../src/knowledge-output-commit.js";
import {
  commitExactKnowledgeBytes,
  fencedFileModes,
} from "../src/knowledge-output-exact-commit.js";

const directories: string[] = [];
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
  delete process.env.DEVELOPER_AFTER_UPDATE_REF;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const fails = (root: string, ...args: string[]) => {
  try {
    git(root, ...args);
    return false;
  } catch {
    return true;
  }
};

function repository(): string {
  const root = mkdtempSync(resolve(tmpdir(), "lervo-exact-commit-"));
  directories.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Developer");
  git(root, "config", "user.email", "developer@example.test");
  writeFileSync(resolve(root, "out.md"), "base\n");
  writeFileSync(resolve(root, "other.md"), "other\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return root;
}

/** The new path: commit the reviewed working-tree bytes with the modes the fence saw. */
function commitReviewed(root: string, paths: string[]) {
  const modes = fencedFileModes(root, paths);
  return commitExactKnowledgeBytes({
    repositoryRoot: root,
    parent: git(root, "rev-parse", "HEAD"),
    entries: paths.map((item) => ({
      path: item,
      bytes: readFileSync(resolve(root, item)),
      mode: modes.get(item) ?? null,
    })),
    messages: ["docs: apply reviewed background knowledge"],
    identity: KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  });
}

/** The former path, for comparison: stage the paths and commit only them. */
function commitFormerly(root: string, paths: string[]): boolean {
  try {
    execFileSync("git", ["-C", root, "add", "-A", "--", ...paths]);
    execFileSync(
      "git",
      [
        "-C",
        root,
        "commit",
        "--only",
        "--quiet",
        "-m",
        "docs: apply reviewed background knowledge",
        "--",
        ...paths,
      ],
      { env: { ...process.env, ...KNOWLEDGE_OUTPUT_COMMIT_IDENTITY }, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

describe.each([
  [
    "new path",
    (root: string, paths: string[]) => commitReviewed(root, paths).then((c) => c !== null),
  ],
  ["former path", async (root: string, paths: string[]) => commitFormerly(root, paths)],
] as const)("%s", (_, commit) => {
  it("gives way to a merge in progress", async () => {
    const root = repository();
    git(root, "checkout", "-qb", "side");
    writeFileSync(resolve(root, "other.md"), "side\n");
    git(root, "commit", "-qam", "side");
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "--no-commit", "side");
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commit(root, ["out.md"])).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(existsSync(resolve(root, ".git/MERGE_HEAD"))).toBe(true);
  });

  it("gives way to a cherry-pick in conflict", async () => {
    const root = repository();
    git(root, "checkout", "-qb", "side");
    writeFileSync(resolve(root, "other.md"), "side\n");
    git(root, "commit", "-qam", "side");
    git(root, "checkout", "-q", "main");
    writeFileSync(resolve(root, "other.md"), "main\n");
    git(root, "commit", "-qam", "main");
    expect(fails(root, "cherry-pick", "side")).toBe(true);
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commit(root, ["out.md"])).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "status", "--porcelain")).toContain("UU other.md");
  });

  it("gives way to a developer holding the index lock", async () => {
    const root = repository();
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    writeFileSync(resolve(root, ".git/index.lock"), "");
    expect(await commit(root, ["out.md"])).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    unlinkSync(resolve(root, ".git/index.lock"));
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
  });

  it("refuses an invalid signing setting", async () => {
    const root = repository();
    git(root, "config", "commit.gpgsign", "invalid");
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commit(root, ["out.md"]).catch(() => false)).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it.each([
    [
      "a new executable",
      "new.sh",
      (root: string) => {
        writeFileSync(resolve(root, "new.sh"), "#!/bin/sh\n");
        chmodSync(resolve(root, "new.sh"), 0o755);
      },
      "100755",
    ],
    [
      "an executable bit added with an edit",
      "out.md",
      (root: string) => {
        writeFileSync(resolve(root, "out.md"), "reviewed\n");
        chmodSync(resolve(root, "out.md"), 0o755);
      },
      "100755",
    ],
    [
      "a link replaced by a regular file",
      "link.md",
      (root: string) => {
        symlinkSync("out.md", resolve(root, "link.md"));
        git(root, "add", "link.md");
        git(root, "commit", "-qm", "link");
        unlinkSync(resolve(root, "link.md"));
        writeFileSync(resolve(root, "link.md"), "reviewed\n");
      },
      "100644",
    ],
  ])("records the file's own mode for %s", async (_label, target, prepare, mode) => {
    const root = repository();
    prepare(root);
    expect(await commit(root, [target])).toBe(true);
    expect(git(root, "ls-tree", "HEAD", "--", target).split(/\s/u)[0]).toBe(mode);
    expect(git(root, "show", `HEAD:${target}`)).toBe(
      readFileSync(resolve(root, target), "utf8").trim(),
    );
  });

  it("records Lervo Knowledge in the reflog", async () => {
    const root = repository();
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commit(root, ["out.md"])).toBe(true);
    expect(git(root, "reflog", "-1", "--format=%gn <%ge>")).toBe(
      "Lervo Knowledge <knowledge@lervo.invalid>",
    );
  });
});

describe("the developer's staged work", () => {
  it("stays staged on a committed path", async () => {
    const root = repository();
    writeFileSync(resolve(root, "out.md"), "base\nstaged hunk\n");
    git(root, "add", "out.md");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commitReviewed(root, ["out.md"])).not.toBeNull();
    expect(git(root, "show", "HEAD:out.md")).toBe("reviewed");
    expect(git(root, "show", ":out.md")).toBe("base\nstaged hunk");
  });

  it("is never lost when the developer stages right after the HEAD move", async () => {
    const root = repository();
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = mkdtempSync(resolve(tmpdir(), "lervo-git-wrapper-"));
    directories.push(bin);
    // After the HEAD move returns, the developer stages a hunk and restores the working tree.
    writeFileSync(
      resolve(bin, "git"),
      `#!/bin/sh\n"${real}" "$@"; status=$?\ncase "$*" in *"update-ref -m"*) [ -n "$DEVELOPER_AFTER_UPDATE_REF" ] && sh -c "$DEVELOPER_AFTER_UPDATE_REF";; esac\nexit $status\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${path}`;
    const added = resolve(bin, "added");
    process.env.DEVELOPER_AFTER_UPDATE_REF = [
      `printf 'reviewed\\ndeveloper hunk\\n' > '${root}/out.md'`,
      `if "${real}" -C '${root}' add out.md; then echo yes > '${added}'; else echo no > '${added}'; fi`,
      `printf 'reviewed\\n' > '${root}/out.md'`,
    ].join("; ");
    writeFileSync(resolve(root, "out.md"), "reviewed\n");
    expect(await commitReviewed(root, ["out.md"])).not.toBeNull();
    process.env.PATH = path;
    // Either Git refused the developer's add while Lervo held the index, or the hunk is staged.
    if (readFileSync(added, "utf8").trim() === "yes")
      expect(git(root, "show", ":out.md")).toBe("reviewed\ndeveloper hunk");
    else expect(git(root, "show", ":out.md")).toBe("reviewed");
  });
});

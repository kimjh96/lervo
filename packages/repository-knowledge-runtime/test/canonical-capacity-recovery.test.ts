import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { retireCapacityBlockedRefDrafts } from "../src/canonical-capacity-recovery.js";

const roots: string[] = [];
const ref = "refs/heads/knowledge-integration";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function retained() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-capacity-ref-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(resolve(root, "guide.md"), "# Owner guide\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "knowledge-integration");
  await writeFile(resolve(root, "owner-ref.md"), "# Independent owner bytes\n");
  await writeFile(resolve(root, "draft.md"), "# Reviewed draft\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "ref only");
  const target = git(root, "rev-parse", ref);
  git(root, "checkout", "-q", "main");
  const drafts = [{ path: "draft.md", beforeHash: null, content: "# Reviewed draft\n" }];
  return { root, repositoryRoot: root, ref, target, drafts, assertCurrent: async () => {} };
}

it("retires only proven ref-only drafts, keeps unrelated ref bytes, and permits a later new-file draft", async () => {
  const input = await retained();
  const beforeHead = git(input.root, "rev-parse", "HEAD");
  const beforeStatus = git(input.root, "status", "--porcelain");
  const result = await retireCapacityBlockedRefDrafts(input);
  expect(result.paths).toEqual(["draft.md"]);
  expect(git(input.root, "rev-parse", `${ref}^`)).toBe(input.target);
  expect(git(input.root, "ls-tree", "--name-only", ref)).not.toContain("draft.md");
  expect(git(input.root, "show", `${ref}:owner-ref.md`)).toBe("# Independent owner bytes");
  expect(git(input.root, "rev-parse", "HEAD")).toBe(beforeHead);
  expect(git(input.root, "status", "--porcelain")).toBe(beforeStatus);
  expect(await readFile(resolve(input.root, "guide.md"), "utf8")).toBe("# Owner guide\n");
});

it("does not retire a ref draft whose root preimage changed", async () => {
  const input = await retained();
  await writeFile(resolve(input.root, "draft.md"), "# Owner content\n");
  await expect(retireCapacityBlockedRefDrafts(input)).rejects.toMatchObject({
    code: "source_bytes_changed",
  });
  expect(git(input.root, "rev-parse", ref)).toBe(input.target);
  expect(await readFile(resolve(input.root, "draft.md"), "utf8")).toBe("# Owner content\n");
});

it("does not retire unproven ref bytes or a moved ref", async () => {
  const input = await retained();
  await expect(
    retireCapacityBlockedRefDrafts({
      ...input,
      drafts: [{ ...input.drafts[0]!, content: "# Different bytes\n" }],
    }),
  ).rejects.toMatchObject({ code: "source_bytes_changed" });
  git(input.root, "update-ref", ref, "HEAD", input.target);
  await expect(retireCapacityBlockedRefDrafts(input)).rejects.toMatchObject({
    code: "source_bytes_changed",
  });
  expect(git(input.root, "rev-parse", ref)).toBe(git(input.root, "rev-parse", "HEAD"));
});

it("keeps a concurrent ref move when the restoration compare-and-swap loses", async () => {
  const input = await retained();
  let checks = 0;
  await expect(
    retireCapacityBlockedRefDrafts({
      ...input,
      assertCurrent: async () => {
        if (++checks === 2) git(input.root, "update-ref", ref, "HEAD", input.target);
      },
    }),
  ).rejects.toMatchObject({ code: "source_bytes_changed" });
  expect(git(input.root, "rev-parse", ref)).toBe(git(input.root, "rev-parse", "HEAD"));
});

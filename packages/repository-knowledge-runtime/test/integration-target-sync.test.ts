import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  resolveIntegrationTarget,
  synchronizeIntegrationTarget,
} from "../src/integration-target-sync.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const hash = (content: string) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const ref = "refs/heads/knowledge-integration";

async function diverged() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-sync-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(resolve(root, "guide.md"), "# Guide\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "base");
  git(root, "branch", "knowledge-integration");
  // The integration ref records a reviewed draft; root apply commits the same bytes separately.
  const draft = "# Guide\n\nIntegrated fact.\n";
  git(root, "checkout", "-q", "knowledge-integration");
  await writeFile(resolve(root, "guide.md"), draft);
  git(root, "commit", "-qam", "integration");
  git(root, "checkout", "-q", "main");
  await writeFile(resolve(root, "guide.md"), draft);
  git(root, "commit", "-qam", "root apply");
  await writeFile(resolve(root, "later.md"), "# Later working-branch document\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "working change");
  return { root, draft };
}

it("records a history-preserving merge with HEAD when every ref-only change was integrated", async () => {
  const { root, draft } = await diverged();
  const before = git(root, "rev-parse", ref);
  expect(
    await synchronizeIntegrationTarget({
      repositoryRoot: root,
      ref,
      integrated: (path, contentHash) => path === "guide.md" && contentHash === hash(draft),
    }),
  ).toBe("synchronized");
  const after = git(root, "rev-parse", ref);
  expect(git(root, "rev-parse", `${after}^{tree}`)).toBe(git(root, "rev-parse", "HEAD^{tree}"));
  expect(git(root, "rev-list", "--parents", "-n", "1", after).split(" ").slice(1)).toEqual([
    before,
    git(root, "rev-parse", "HEAD"),
  ]);
  expect(git(root, "show", `${after}:later.md`)).toContain("Later working-branch document");
  // The repository's own identity is not borrowed for Lervo's merge.
  expect(git(root, "log", "-1", "--format=%an <%ae>%n%cn <%ce>", after)).toBe(
    "Lervo Knowledge Worker <knowledge@lervo.invalid>\nLervo Knowledge Worker <knowledge@lervo.invalid>",
  );
});

it("leaves the ref untouched when it holds bytes that never settled integration", async () => {
  const { root } = await diverged();
  const before = git(root, "rev-parse", ref);
  expect(
    await synchronizeIntegrationTarget({ repositoryRoot: root, ref, integrated: () => false }),
  ).toBe("unchanged");
  expect(git(root, "rev-parse", ref)).toBe(before);
});

it("fast-forwards a ref that HEAD already contains", async () => {
  const { root } = await diverged();
  git(root, "update-ref", ref, "HEAD~1");
  expect(
    await synchronizeIntegrationTarget({ repositoryRoot: root, ref, integrated: () => false }),
  ).toBe("synchronized");
  expect(git(root, "rev-parse", ref)).toBe(git(root, "rev-parse", "HEAD"));
});

it("starts an absent delegated integration ref at HEAD without touching the working branch", async () => {
  const { root } = await diverged();
  git(root, "update-ref", "-d", ref);
  const status = git(root, "status", "--porcelain");
  expect(await resolveIntegrationTarget(root, ref)).toBeNull();
  expect(
    await synchronizeIntegrationTarget({ repositoryRoot: root, ref, integrated: () => false }),
  ).toBe("created");
  expect(git(root, "rev-parse", ref)).toBe(git(root, "rev-parse", "HEAD"));
  expect(git(root, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  expect(git(root, "status", "--porcelain")).toBe(status);
});

it("records a typed unavailable target when HEAD has no commit to start the ref from", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-sync-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  await expect(
    synchronizeIntegrationTarget({ repositoryRoot: root, ref, integrated: () => false }),
  ).rejects.toMatchObject({ code: "knowledge_integration_target_unavailable" });
});

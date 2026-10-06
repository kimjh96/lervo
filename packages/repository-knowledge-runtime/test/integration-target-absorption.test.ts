import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { validateSchema } from "@lervo/schemas";

import { synchronizeIntegrationTarget } from "../src/integration-target-sync.js";
import { recordIntegrationTargetAbsorbed } from "../src/integration-target-absorption-event.js";
import {
  ABSORBED_INTEGRATION_BACKUP_PREFIX,
  inspectIntegrationTargetAbsorption,
} from "../src/integration-target-absorption.js";
import {
  changedRepositoryPaths,
  withVerificationSourceChanges,
} from "../src/verification-source-changes.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const ref = "refs/heads/knowledge-integration";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const lervo = [
  "-c",
  "user.name=Lervo Knowledge Worker",
  "-c",
  "user.email=knowledge@lervo.invalid",
];

async function write(root: string, path: string, content: string) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), content);
}

/**
 * The installed shiflo shape: an owner support commit and Lervo knowledge commits land on the
 * integration ref, then the owner squash-merges a reconciled version of that work into `main`.
 */
async function squashMerged(options: { ownerOnlyFile?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-absorption-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "owner@example.com");
  git(root, "config", "user.name", "Owner");
  await write(root, "docs/guide.md", "# Guide\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "branch", "knowledge-integration");
  git(root, "checkout", "-q", "knowledge-integration");
  await write(root, "tools/verify.mjs", "export const verify = true;\n");
  if (options.ownerOnlyFile) await write(root, "tools/owner-only.mjs", "export const kept = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "owner support");
  await write(root, "docs/guide.md", "# Guide\n\nIntegrated fact.\n");
  await write(root, "docs/unadopted.md", "# Unadopted\n\nA proposal the squash merge left out.\n");
  git(root, "add", ".");
  git(root, ...lervo, "commit", "-qm", "docs: apply reviewed canonical knowledge");
  git(root, "checkout", "-q", "main");
  // The squash merge reconciles the guide differently and leaves the second document out.
  await write(root, "tools/verify.mjs", "export const verify = true;\n");
  await write(root, "docs/guide.md", "# Guide\n\nIntegrated fact, reconciled.\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "chore: reconcile repository knowledge (#47)");
  await write(root, "README.md", "# Readme\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "release");
  return root;
}

it("moves a squash-absorbed integration ref to HEAD, keeps a backup, and records the event", async () => {
  const root = await squashMerged();
  const before = git(root, "rev-parse", ref);
  const head = git(root, "rev-parse", "HEAD");
  const recorded: unknown[] = [];
  const status = git(root, "status", "--porcelain");
  expect(
    await synchronizeIntegrationTarget({
      repositoryRoot: root,
      ref,
      integrated: () => false,
      recordAbsorbed: (absorption) => recorded.push(absorption),
    }),
  ).toBe("absorbed");
  expect(git(root, "rev-parse", ref)).toBe(head);
  expect(git(root, "rev-parse", `${ABSORBED_INTEGRATION_BACKUP_PREFIX}${before}`)).toBe(before);
  expect(git(root, "rev-parse", "refs/heads/main")).toBe(head);
  expect(git(root, "status", "--porcelain")).toBe(status);
  expect(recorded).toEqual([
    expect.objectContaining({
      target: before,
      head,
      absorbedPaths: ["docs/guide.md", "tools/verify.mjs"],
      droppedPaths: ["docs/unadopted.md"],
      pathSetHash: expect.stringMatching(/^sha256:/u),
    }),
  ]);
});

it("keeps canonical_target_diverged semantics for owner content the base never received", async () => {
  const root = await squashMerged({ ownerOnlyFile: true });
  const before = git(root, "rev-parse", ref);
  expect(
    await inspectIntegrationTargetAbsorption(root, before, git(root, "rev-parse", "HEAD")),
  ).toBeNull();
  expect(
    await synchronizeIntegrationTarget({ repositoryRoot: root, ref, integrated: () => false }),
  ).toBe("unchanged");
  expect(git(root, "rev-parse", ref)).toBe(before);
});

it("does not treat unpublished Lervo work as absorbed when the base decided none of it", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-unpublished-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "owner@example.com");
  git(root, "config", "user.name", "Owner");
  await write(root, "docs/guide.md", "# Guide\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "branch", "knowledge-integration");
  git(root, "checkout", "-q", "knowledge-integration");
  await write(root, "docs/new.md", "# New\n");
  git(root, "add", ".");
  git(root, ...lervo, "commit", "-qm", "docs: apply reviewed canonical knowledge");
  git(root, "checkout", "-q", "main");
  await write(root, "src/app.ts", "export {};\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "unrelated work");
  expect(
    await inspectIntegrationTargetAbsorption(
      root,
      git(root, "rev-parse", ref),
      git(root, "rev-parse", "HEAD"),
    ),
  ).toBeNull();
});

it("names the exact paths a verification suite changed while it ran", async () => {
  const states = [
    {
      revision: "r1",
      files: new Map([
        ["pnpm-lock.yaml", "a"],
        ["docs/guide.md", "g"],
      ]),
    },
    {
      revision: "r2",
      files: new Map([
        ["pnpm-lock.yaml", "b"],
        ["docs/guide.md", "g"],
        ["bun.lock", "c"],
      ]),
    },
  ];
  expect(changedRepositoryPaths(states[0]!, states[1]!)).toEqual(["bun.lock", "pnpm-lock.yaml"]);
  const stored: string[] = [];
  let call = 0;
  const failure = await withVerificationSourceChanges(
    {
      put: async (content: string | Uint8Array) => {
        stored.push(String(content));
        return { contentHash: `sha256:${"a".repeat(64)}` };
      },
    } as never,
    async () => states[Math.min(call++, 1)]!,
    async (capture) => {
      await capture("root");
      await capture("root");
      throw Object.assign(new Error("changed"), { code: "repository_changed_during_verification" });
    },
  ).catch((error: unknown) => error);
  expect(failure).toMatchObject({
    code: "knowledge_verification_modified_sources",
    dependencyHash: `sha256:${"a".repeat(64)}`,
  });
  expect(JSON.parse(stored[0]!)).toMatchObject({
    kind: "verification_source_changes",
    changedPathCount: 2,
    paths: ["bun.lock", "pnpm-lock.yaml"],
  });
  // Any other runner failure keeps its own meaning.
  await expect(
    withVerificationSourceChanges(
      {} as never,
      async () => states[0]!,
      async () => {
        throw Object.assign(new Error("failed"), { code: "verification_suite_not_found" });
      },
    ),
  ).rejects.toMatchObject({ code: "verification_suite_not_found" });
});

it("records an absorption event whose payload satisfies the canonical schema", () => {
  const appended: { type: string; payload: unknown }[] = [];
  const storage = {
    manifest: { projectId: "prj_absorption" },
    writableEventSchemaVersion: 4,
    events: {
      get: () => null,
      append: (event: { type: string; payload: unknown }) => appended.push(event),
    },
  } as never;
  const commit = (digit: string) => digit.repeat(40);
  const absorption = {
    target: commit("a"),
    head: commit("b"),
    base: commit("c"),
    absorbedPaths: ["docs/guide.md"],
    droppedPaths: ["docs/unadopted.md"],
    pathSetHash: `sha256:${"d".repeat(64)}`,
  };
  expect(recordIntegrationTargetAbsorbed(storage, absorption, "2026-10-07T00:00:00.000Z")).toBe(
    true,
  );
  expect(appended[0]!.type).toBe("knowledge.integration_target.absorbed");
  expect(
    validateSchema("knowledgeIntegrationTargetAbsorbedEventPayload", appended[0]!.payload).valid,
  ).toBe(true);
  expect(JSON.stringify(appended[0]!.payload)).not.toContain("docs/");
});

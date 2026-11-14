import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_AUTHOR,
  commitSettledKnowledgeOutputs,
  selectSettledKnowledgeOutputs,
} from "../src/knowledge-output-commit.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

it(
  "commits only settled reviewed outputs and leaves developer work untouched",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const before = git(f.root, "rev-parse", "HEAD");
    for (let i = 0; i < 16; i++) {
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `commit-${i}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
      if (
        git(f.root, "rev-parse", "HEAD") !== before &&
        (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent
      )
        break;
    }
    const commit = git(f.root, "rev-parse", "HEAD");
    expect(commit).not.toBe(before);
    // Currency is recorded for the post-commit snapshot, so no extra cycle follows the commit.
    expect(await inspectAutonomousKnowledgeStatus(f.storage)).toMatchObject({
      baselineCurrent: true,
    });
    const identity = `${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.name} <${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email}>`;
    // Outputs land at successive batch boundaries, so one cycle may produce several commits.
    // The committer is explicit too, so no commit depends on an ambient Git identity.
    const commits = git(f.root, "log", "--format=%an <%ae>|%cn <%ce>|%s", `${before}..HEAD`);
    expect(commits.split("\n").length).toBeGreaterThanOrEqual(1);
    for (const line of commits.split("\n"))
      expect(line).toBe(`${identity}|${identity}|docs: apply reviewed background knowledge`);
    const committed = git(f.root, "log", "--name-only", "--format=", `${before}..HEAD`)
      .split("\n")
      .filter(Boolean);
    // The developer's uncommitted source change stays in the working tree.
    expect(committed).not.toContain("src/runtime.ts");
    expect(git(f.root, "status", "--porcelain")).toContain(" M src/runtime.ts");
    expect(committed).toContain("docs/specs/runtime.md");
    expect(
      committed.every((path) => path.startsWith("docs/") || path.startsWith(".lervo/knowledge/")),
    ).toBe(true);
    expect(await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8")).toContain(
      "limited to three per host",
    );

    // Developer edits and staged work are never swept into a knowledge commit.
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 4;\n",
    );
    await writeFile(resolve(f.root, "notes.md"), "# Draft notes\n");
    git(f.root, "add", "notes.md");
    expect(
      await commitSettledKnowledgeOutputs({
        repositoryRoot: f.root,
        events: f.events,
        artifacts: f.artifacts,
        obligationId: "kconv_test",
        reviewed: {
          head: commit,
          sources: new Map(
            captureConvergenceSources(f.root, "policy").sources.map((source) => [
              source.path,
              source.contentHash,
            ]),
          ),
        },
      }),
    ).toEqual({ committed: [], head: null });
    expect(git(f.root, "rev-parse", "HEAD")).toBe(commit);
    expect(git(f.root, "status", "--porcelain")).toContain("A  notes.md");
    expect(git(f.root, "status", "--porcelain")).toContain(" M src/runtime.ts");
  },
);

it(
  "commits integrated outputs at the next batch boundary without waiting for lifecycle verification",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const before = git(f.root, "rev-parse", "HEAD");
    // One stage per cycle, stopping as soon as the commit lands, as a busy repository would.
    for (let i = 0; i < 16 && git(f.root, "rev-parse", "HEAD") === before; i++)
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `boundary-${i}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
    expect(git(f.root, "rev-parse", "HEAD")).not.toBe(before);
    expect(git(f.root, "log", "-1", "--format=%s")).toBe(
      "docs: apply reviewed background knowledge",
    );
    expect(git(f.root, "show", "--name-only", "--format=", "HEAD").split("\n")).toContain(
      "docs/specs/runtime.md",
    );
    const stages = f.events
      .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
      .map((event) => event.payload as { stage: string; state: string });
    expect(stages.some((stage) => stage.stage === "canonical_integration")).toBe(true);
    expect(stages.some((stage) => stage.stage === "lifecycle_verification")).toBe(false);
    // The commit is the boundary stage's own fenced effect: it re-queues that stage on the
    // post-commit snapshot rather than superseding the obligation.
    const boundary = stages.at(-2)!;
    expect(["assessment", "normalization_generation"]).toContain(boundary.stage);
    expect(boundary.state).toBe("current");
    expect(stages.at(-1)).toMatchObject({ stage: boundary.stage, state: "queued" });
    // The boundary directly follows the integration whose draft it committed.
    expect(stages.at(-4)).toMatchObject({ stage: "canonical_integration", state: "current" });
    expect(
      f.events.list({ limit: 1_000, types: ["repository.knowledge.convergence.recorded"] }),
    ).toEqual([]);
  },
);

it("follows committed preimage, integrated draft, and reviewed normalization as one chain", async () => {
  const head = new Map<string, string | null>([
    ["docs/spec.md", "sha256:committed"],
    [".lervo/knowledge/document-normalizations/aa/old.yaml", "sha256:old-record"],
  ]);
  const current = new Map([
    ["docs/spec.md", "sha256:normalized"],
    ["docs/spec/child.md", "sha256:child"],
    [".lervo/knowledge/document-normalizations/bb/new.yaml", "sha256:new-record"],
    ["docs/user.md", "sha256:user"],
    ["src/index.ts", "sha256:code"],
  ]);
  const selection = (drafts: Map<string, string | null>) =>
    selectSettledKnowledgeOutputs({
      dirty: new Map([
        ["docs/spec.md", "present"],
        ["docs/spec/child.md", "present"],
        [".lervo/knowledge/document-normalizations/bb/new.yaml", "present"],
        [".lervo/knowledge/document-normalizations/aa/old.yaml", "deleted"],
        ["docs/user.md", "present"],
        ["src/index.ts", "present"],
      ]),
      head: async (path) => head.get(path) ?? null,
      current: (path) => current.get(path)!,
      drafts,
      records: [
        {
          path: ".lervo/knowledge/document-normalizations/bb/new.yaml",
          reviewedRewritePaths: ["docs/spec.md", "docs/spec/child.md"],
          source: { sourcePath: "docs/spec.md", sourceContentHash: "sha256:drafted" },
        },
      ],
      deletedRecordSource: async () => ({ sourcePath: "docs/spec.md" }),
    });
  expect(await selection(new Map([["docs/spec.md\0sha256:drafted", "sha256:committed"]]))).toEqual([
    ".lervo/knowledge/document-normalizations/aa/old.yaml",
    ".lervo/knowledge/document-normalizations/bb/new.yaml",
    "docs/spec.md",
    "docs/spec/child.md",
  ]);
  // A draft over uncommitted developer bytes breaks the chain, so nothing is selected.
  expect(
    await selection(new Map([["docs/spec.md\0sha256:drafted", "sha256:uncommitted"]])),
  ).toEqual([]);
});

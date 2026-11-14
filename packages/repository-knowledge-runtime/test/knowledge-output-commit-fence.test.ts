import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

/**
 * Another writer edits a settled output while the boundary commit runs, after its exact fence.
 * Whatever the commit records must be the reviewed bytes the fence saw, never the edit.
 */
const MARKER = "concurrent developer edit";
const plan = vi.hoisted(() => ({
  at: null as string | null,
  fired: false,
  root: "",
  /** Commits a boundary call made while, or after, the edit landed inside it. */
  editedCommits: [] as string[],
}));

function editOnce(at: string) {
  if (plan.at !== at || plan.fired) return;
  if (!(new Error().stack ?? "").includes("knowledge-output-commit.ts")) return;
  plan.fired = true;
  appendFileSync(resolve(plan.root, "docs/specs/runtime.md"), `\n${MARKER}\n`);
}

vi.mock("../src/knowledge-output-commit.js", async (load) => {
  const actual = await load<typeof import("../src/knowledge-output-commit.js")>();
  return {
    ...actual,
    commitSettledKnowledgeOutputs: async (
      ...args: Parameters<typeof actual.commitSettledKnowledgeOutputs>
    ) => {
      const firedBefore = plan.fired;
      const output = await actual.commitSettledKnowledgeOutputs(...args);
      if (!firedBefore && plan.fired && output.head !== null)
        plan.editedCommits.push(output.head.after);
      return output;
    },
  };
});
vi.mock("../src/convergence-owner-fence.js", async (load) => {
  const actual = await load<typeof import("../src/convergence-owner-fence.js")>();
  return {
    ...actual,
    knowledgeOutputCommitGrant: async (
      ...args: Parameters<typeof actual.knowledgeOutputCommitGrant>
    ) => {
      editOnce("grant");
      return actual.knowledgeOutputCommitGrant(...args);
    },
  };
});
vi.mock("../src/canonical-disposition-ledger.js", async (load) => {
  const actual = await load<typeof import("../src/canonical-disposition-ledger.js")>();
  return {
    ...actual,
    integratedCanonicalDrafts: async (
      ...args: Parameters<typeof actual.integratedCanonicalDrafts>
    ) => {
      editOnce("ledger");
      return actual.integratedCanonicalDrafts(...args);
    },
  };
});
vi.mock("../src/knowledge-output-formatter.js", async (load) => {
  const actual = await load<typeof import("../src/knowledge-output-formatter.js")>();
  return {
    ...actual,
    // A formatter that leaves bytes unchanged, so every selected output reaches the commit.
    loadRepositoryKnowledgeOutputFormatter: async () => {
      editOnce("formatter_load");
      return {
        format: async (_path: string, content: string) => {
          editOnce("formatter_format");
          return content;
        },
      };
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
beforeEach(() => Object.assign(plan, { at: null, fired: false, editedCommits: [] }));
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

it.each(["grant", "ledger", "formatter_load", "formatter_format"])(
  "commits only reviewed bytes when a settled output is edited during %s",
  { timeout: 600_000 },
  async (at) => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const before = git(f.root, "rev-parse", "HEAD");
    Object.assign(plan, { at, root: f.root });
    for (let cycle = 0; cycle < 30; cycle++) {
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `commit-fence-${cycle}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      }).catch((error: unknown) => {
        if ((error as { code?: string }).code !== "source_bytes_changed") throw error;
      });
      if (
        plan.fired &&
        git(f.root, "rev-parse", "HEAD") !== before &&
        (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent
      )
        break;
    }
    expect(plan.fired).toBe(true);
    // A commit from the call the edit landed in may only hold the reviewed bytes. Later
    // obligations review the edited bytes and may commit them legitimately.
    for (const commit of plan.editedCommits)
      expect(git(f.root, "show", `${commit}:docs/specs/runtime.md`)).not.toContain(MARKER);
  },
);

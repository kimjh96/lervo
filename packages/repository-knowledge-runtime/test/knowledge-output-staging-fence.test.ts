import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

/**
 * The developer acts after the formatter wrote a settled output and before the staging fence.
 * The fence must refuse, and its refusal must leave the developer's working tree as they left it.
 */
const MARKER = "concurrent developer edit";
const FORMATTED = "<!-- formatted -->\n";
const plan = vi.hoisted(() => ({
  mode: "" as "" | "edit_x" | "edit_x_and_y" | "delete_x" | "readonly_x_edit_y",
  fired: false,
  root: "",
  error: null as unknown,
  commits: [] as string[],
}));

vi.mock("../src/knowledge-output-commit.js", async (load) => {
  const actual = await load<typeof import("../src/knowledge-output-commit.js")>();
  return {
    ...actual,
    commitSettledKnowledgeOutputs: async (
      ...args: Parameters<typeof actual.commitSettledKnowledgeOutputs>
    ) => {
      const firedBefore = plan.fired;
      try {
        const output = await actual.commitSettledKnowledgeOutputs(...args);
        if (!firedBefore && plan.fired && output.head !== null)
          plan.commits.push(output.head.after);
        return output;
      } catch (error) {
        if (!firedBefore && plan.fired) plan.error = error;
        throw error;
      }
    },
  };
});
vi.mock("../src/knowledge-output-formatter.js", async (load) => {
  const actual = await load<typeof import("../src/knowledge-output-formatter.js")>();
  return {
    ...actual,
    // An idempotent formatter that really changes the settled Markdown output.
    loadRepositoryKnowledgeOutputFormatter: async () => ({
      format: async (path: string, content: string) =>
        path.endsWith("docs/specs/runtime.md") && !content.endsWith(FORMATTED)
          ? content + FORMATTED
          : content,
    }),
    // The developer acts after the formatter wrote, before the staging fence (the remaining
    // formatter calls and `git rev-parse HEAD` are awaits inside this window).
    formatKnowledgeOutputFiles: async (
      ...args: Parameters<typeof actual.formatKnowledgeOutputFiles>
    ) => {
      const replaced = await actual.formatKnowledgeOutputFiles(...args);
      if (
        !plan.fired &&
        replaced.has("docs/specs/runtime.md") &&
        (new Error().stack ?? "").includes("knowledge-output-commit.ts")
      ) {
        plan.fired = true;
        const x = resolve(plan.root, "docs/specs/runtime.md");
        if (plan.mode === "delete_x") rmSync(x);
        // A formatted output the restore cannot write, refused for an unrelated edit.
        else if (plan.mode === "readonly_x_edit_y") chmodSync(x, 0o444);
        else appendFileSync(x, `\n${MARKER}\n`);
        if (plan.mode === "edit_x_and_y" || plan.mode === "readonly_x_edit_y")
          appendFileSync(resolve(plan.root, "README.md"), "\nunrelated developer edit\n");
      }
      return replaced;
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
beforeEach(() => Object.assign(plan, { mode: "", fired: false, error: null, commits: [] }));
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    if (existsSync(resolve(f.root, "docs/specs/runtime.md")))
      chmodSync(resolve(f.root, "docs/specs/runtime.md"), 0o644);
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

async function runUntilFired(mode: typeof plan.mode) {
  const f = await fixture(true, true);
  fixtures.push(f);
  await writeFile(resolve(f.root, "src/runtime.ts"), "export const maximumBackgroundCalls = 3;\n");
  Object.assign(plan, { mode, root: f.root });
  for (let cycle = 0; cycle < 30 && !plan.fired; cycle++)
    await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: `review-${cycle}`,
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    }).catch(() => undefined);
  expect(plan.fired).toBe(true);
  const x = resolve(f.root, "docs/specs/runtime.md");
  const report = {
    mode,
    error:
      plan.error === null ? null : String((plan.error as { code?: string }).code ?? plan.error),
    committedWithMarker: plan.commits.map((c) =>
      git(f.root, "show", `${c}:docs/specs/runtime.md`).includes(MARKER),
    ),
    workingTreeExists: existsSync(x),
    workingTreeHasMarker: existsSync(x) && readFileSync(x, "utf8").includes(MARKER),
    workingTreeFormatted: existsSync(x) && readFileSync(x, "utf8").endsWith(FORMATTED),
    status: git(f.root, "status", "--porcelain"),
  };
  return report;
}

it(
  "refuses, never commits, an edit to a formatted output made after formatting",
  { timeout: 600_000 },
  async () => {
    const r = await runUntilFired("edit_x");
    expect(r.error).toBe("source_bytes_changed");
    expect(r.committedWithMarker).not.toContain(true);
  },
);
it(
  "keeps a developer edit to a formatted output when the fence refuses",
  { timeout: 600_000 },
  async () => {
    const r = await runUntilFired("edit_x_and_y");
    expect(r.workingTreeHasMarker).toBe(true);
  },
);
it("never recreates a formatted output the developer deleted", { timeout: 600_000 }, async () => {
  const r = await runUntilFired("delete_x");
  expect(r.error).toBe("source_bytes_changed");
  expect(r.workingTreeExists).toBe(false);
});
it(
  "keeps the fence's classified refusal when a restore cannot write",
  { timeout: 600_000 },
  async () => {
    const r = await runUntilFired("readonly_x_edit_y");
    expect(r.error).toBe("source_bytes_changed");
    expect(r.committedWithMarker).toEqual([]);
  },
);

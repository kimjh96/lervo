import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { defaultDecisionTaxonomy, serializeDecisionTaxonomy } from "@lervo/project";

import {
  classifyReplayPaths,
  collectReplayCases,
  readFindReplaySummary,
  scoreReplayCase,
  summarizeReplay,
  writeFindReplayReport,
} from "../src/find-replay.js";

const identity = (email: string) => ({
  GIT_AUTHOR_NAME: email,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: email,
  GIT_COMMITTER_EMAIL: email,
});

async function commit(root: string, files: Record<string, string>, subject: string, email: string) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const env = { ...process.env, ...identity(email) };
  execFileSync("git", ["-C", root, "add", "-A"], { env });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", subject], { env });
}

describe("find replay", () => {
  it("separates targeted code from co-changed governing documents", async () => {
    const taxonomy = defaultDecisionTaxonomy;
    expect(
      classifyReplayPaths(
        [
          "apps/cli/src/a.ts",
          "AGENTS.md",
          "docs/decisions/0001-choose.md",
          "docs/evidence/run.md",
          "package.json",
          ".lervo/knowledge/document-layout.yaml",
        ],
        taxonomy,
      ),
    ).toEqual({
      targetPaths: ["apps/cli/src/a.ts", "package.json"],
      expected: ["AGENTS.md", "docs/decisions/0001-choose.md"],
    });
  });

  it("scores recall, precision, and first rank per case and in summary", () => {
    const replay = {
      commit: "c1",
      subject: "feat: x",
      targetPaths: ["src/x.ts"],
      expected: ["docs/decisions/a.md", "docs/specifications/b.md"],
    };
    const hit = scoreReplayCase(replay, ["docs/other.md", "docs/decisions/a.md"]);
    expect(hit).toEqual({
      commit: "c1",
      expectedCount: 2,
      foundCount: 1,
      firstRank: 2,
      recall: 0.5,
      precision: 0.5,
    });
    const miss = scoreReplayCase({ ...replay, commit: "c2" }, []);
    expect(miss).toMatchObject({ foundCount: 0, firstRank: null, recall: 0, precision: 0 });
    expect(summarizeReplay([hit, miss], 8, new Date("2026-11-01T00:00:00Z"))).toMatchObject({
      caseCount: 2,
      recall: 0.25,
      precision: 0.25,
      hitRate: 0.5,
      meanReciprocalRank: 0.25,
    });
    expect(summarizeReplay([], 8, new Date())).toMatchObject({ caseCount: 0, recall: null });
  });

  it("collects only development commits that changed code and existing governing documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-replay-"));
    execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
    await commit(
      root,
      {
        "README.md": "# Repo\n",
        ".lervo/knowledge/document-layout.yaml": serializeDecisionTaxonomy(),
      },
      "chore: start",
      "dev@example.invalid",
    );
    await commit(
      root,
      { "src/a.ts": "export {};\n", "docs/decisions/0001-a.md": "# A\n" },
      "feat: add a",
      "dev@example.invalid",
    );
    await commit(root, { "src/b.ts": "export {};\n" }, "feat: code only", "dev@example.invalid");
    await commit(
      root,
      { "src/c.ts": "export {};\n", "docs/decisions/0002-c.md": "# C\n" },
      "docs: apply reviewed background knowledge",
      "knowledge@lervo.invalid",
    );
    const cases = await collectReplayCases(root, 10);
    expect(cases).toEqual([
      expect.objectContaining({
        subject: "feat: add a",
        targetPaths: ["src/a.ts"],
        expected: ["docs/decisions/0001-a.md"],
      }),
    ]);
  });

  it("round-trips the summary and rejects an invalid report", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-replay-state-"));
    expect(await readFindReplaySummary(root)).toBeNull();
    await writeFindReplayReport(root, summarizeReplay([], 8, new Date("2026-11-01T00:00:00Z")));
    expect(await readFindReplaySummary(root)).toEqual({
      observedAt: "2026-11-01T00:00:00.000Z",
      caseCount: 0,
      recall: null,
      precision: null,
    });
    await writeFile(join(root, ".lervo/state/find-replay.json"), '{"schemaVersion":1}');
    expect(await readFindReplaySummary(root)).toBeNull();
  });
});

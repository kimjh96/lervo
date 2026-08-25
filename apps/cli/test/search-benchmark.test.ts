import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
const taskTypes = [
  "exact_repository_terminology",
  "wording_morphology_variation",
  "multiple_expected_sources",
  "ambiguous_near_neighbor",
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lervo search benchmark", () => {
  it("records aggregate quality and latency without query text or document paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-search-benchmark-cli-"));
    roots.push(root);
    await mkdir(resolve(root, "docs"));
    await mkdir(resolve(root, "benchmarks"));
    await writeFile(
      resolve(root, "docs/guide.md"),
      "# Authentication guide\n\nAuthenticates requests.\n",
    );
    const cases = taskTypes.flatMap((taskType, taskIndex) =>
      Array.from({ length: 5 }, (_, caseIndex) => ({
        caseId: `spcase_fixture_${taskIndex}_${caseIndex}`,
        taskType,
        provenance: "verification_authored",
        query: "authentication",
        expectedPaths: ["docs/guide.md"],
        maximumRank: 10,
      })),
    );
    await writeFile(
      resolve(root, "benchmarks/suite.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        suiteId: "spbench_fixture.v1",
        publicQueries: true,
        corpusRoots: ["docs"],
        corpusExclusions: [],
        taskTypes: taskTypes.map((taskType) => ({ taskType, minimumCases: 5 })),
        cases,
      })}\n`,
    );
    let output = "";
    let error = "";
    const code = await runCli(
      ["search", "benchmark", "--suite", "benchmarks/suite.json", "--json"],
      {
        cwd: root,
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          error += message;
        },
      },
    );
    expect(code, error).toBe(0);
    const result = JSON.parse(output) as {
      report: {
        baseline: { warmQueryLatency: { sampleCount: number } };
        corpusDocumentCount: number;
      };
      reportPath: string;
    };
    expect(result.report.corpusDocumentCount).toBe(1);
    expect(result.report.baseline.warmQueryLatency.sampleCount).toBe(600);
    const files = await readdir(resolve(root, ".lervo/state/search/performance-reports"));
    expect(files).toHaveLength(1);
    const reportPath = resolve(root, result.reportPath);
    const reportBytes = await readFile(reportPath, "utf8");
    expect(reportBytes).not.toContain("authentication");
    expect(reportBytes).not.toContain("docs/guide.md");
    expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
  });
});

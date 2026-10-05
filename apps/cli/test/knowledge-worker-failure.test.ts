import { expect, it } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { knowledgeWorkerFailureLine } from "../src/knowledge-worker-failure.js";

it("names the changed source of a typed failure and shortens the repository root", () => {
  expect(
    knowledgeWorkerFailureLine(
      new RepositoryKnowledgeError(
        "source_bytes_changed",
        "/work/repo/docs/specs/runtime.md changed during the scan.",
      ),
      "/work/repo",
    ),
  ).toBe(
    "Knowledge convergence failed: source_bytes_changed (./docs/specs/runtime.md changed during the scan.)\n",
  );
});

it("keeps typed detail on one bounded line", () => {
  const line = knowledgeWorkerFailureLine(
    new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `docs/a.md escapes\nthe root ${"x".repeat(500)}`,
    ),
    "/work/repo",
  );
  expect(line.startsWith("Knowledge convergence failed: knowledge_source_unsafe (docs/a.md")).toBe(
    true,
  );
  expect(line.trimEnd()).not.toMatch(/[\r\n]/u);
  expect(line.length).toBeLessThan(400);
});

it("keeps native errors and invalid codes code-only", () => {
  expect(
    knowledgeWorkerFailureLine(
      Object.assign(new Error("ENOENT: /Users/someone/private/file"), { code: "Not A Code" }),
      "/work/repo",
    ),
  ).toBe("Knowledge convergence failed: knowledge_job_transient_failure\n");
  expect(knowledgeWorkerFailureLine({ code: "knowledge_source_unsafe" }, "/work/repo")).toBe(
    "Knowledge convergence failed: knowledge_source_unsafe\n",
  );
});

import { describe, expect, it } from "vitest";

import { evaluateReleaseCi } from "../lib/ci-release-admission.mjs";
import { observeReleaseCi } from "../lib/ci-release-observation.mjs";
import { renderReleasePrBody } from "../lib/release-pr-body.mjs";

const revision = "a".repeat(40);
const repository = "owner/repository";
const run = {
  id: 7,
  head_sha: revision,
  head_branch: "main",
  head_repository: { full_name: repository },
  workflow_id: 3,
  event: "push",
  status: "completed",
  conclusion: "success",
};
const jobs = [
  "ESLint and Prettier",
  "CI verification (lervo-ci-v1)",
  "Release manifest and SBOM",
  "Distribution smoke checks",
  ...[1, 2, 3, 4].map((shard) => `Tests (shard ${shard}/4)`),
].map((name) => ({
  name,
  conclusion: "success",
  ...(name === "Release manifest and SBOM"
    ? { steps: [{ name: "Release metadata mode: exact", conclusion: "success" }] }
    : {}),
}));
const input = { repository, revision, workflowId: 3, run, jobs, requireFull: true };

describe("release effect CI admission", () => {
  it("requires exact repository, revision, branch, workflow, event and successful completion", () => {
    expect(evaluateReleaseCi(input).status).toBe("ready");
    for (const mismatch of [
      { head_sha: "b".repeat(40) },
      { head_branch: "feature" },
      { head_repository: { full_name: "fork/repository" } },
      { workflow_id: 4 },
      { event: "pull_request" },
      { status: "in_progress" },
      { conclusion: "cancelled" },
    ])
      expect(evaluateReleaseCi({ ...input, run: { ...run, ...mismatch } }).status).toBe("blocked");
  });
  it("allows light source generation but forbids tagging from light or incomplete coverage", () => {
    const light = jobs.slice(0, 2);
    expect(evaluateReleaseCi({ ...input, jobs: light, requireFull: false }).status).toBe("ready");
    expect(evaluateReleaseCi({ ...input, jobs: light }).reason).toBe(
      "release_ci_full_coverage_missing",
    );
    for (const missing of jobs)
      expect(
        evaluateReleaseCi({ ...input, jobs: jobs.filter((job) => job !== missing) }).status,
      ).toBe("blocked");
  });
  it("tags only from a run that checked the committed release metadata exactly", () => {
    const withBuildSteps = (steps) =>
      jobs.map((job) => (job.name === "Release manifest and SBOM" ? { ...job, steps } : job));
    for (const steps of [
      undefined,
      [],
      [{ name: "Release metadata mode: generated", conclusion: "success" }],
      [{ name: "Release metadata mode: exact", conclusion: "skipped" }],
    ])
      expect(evaluateReleaseCi({ ...input, jobs: withBuildSteps(steps) }).reason).toBe(
        "release_ci_metadata_not_exact",
      );
    // Source generation does not tag, so it does not need an exact run.
    expect(
      evaluateReleaseCi({
        ...input,
        jobs: withBuildSteps([{ name: "Release metadata mode: generated", conclusion: "success" }]),
        requireFull: false,
      }).status,
    ).toBe("ready");
  });

  it("stops before querying runs when main has moved", () => {
    const requested = [];
    expect(
      observeReleaseCi({
        repository,
        revision,
        request: (path) => {
          requested.push(path);
          return { object: { sha: "b".repeat(40) } };
        },
      }).reason,
    ).toBe("release_main_superseded");
    expect(requested).toHaveLength(1);
  });
  it("loads the exact run and latest job attempt rather than assuming success from a name", () => {
    const request = (path) => {
      if (path.endsWith("git/ref/heads/main")) return { object: { sha: revision } };
      if (path.endsWith("workflows/code-quality.yml")) return { id: 3 };
      if (path.endsWith("runs/7")) return run;
      expect(path).toContain("filter=latest");
      return { jobs, total_count: jobs.length };
    };
    expect(
      observeReleaseCi({ repository, revision, runId: 7, requireFull: true, request }).status,
    ).toBe("ready");
    expect(() => observeReleaseCi({ repository, revision, runId: "../8", request })).toThrow(
      "release_ci_run_invalid",
    );
  });
});

it("renders observed generation evidence and leaves candidate verification open", () => {
  const body = renderReleasePrBody({
    repository,
    sourceRevision: revision,
    releaseRevision: "b".repeat(40),
    planId: `relprep_${"c".repeat(24)}`,
    runId: 7,
  });
  expect(body.startsWith("## Summary")).toBe(true);
  expect(body).toContain(
    "Full tests, quality checks, knowledge lint, and distribution verification are pending",
  );
  expect(body).toContain("- [ ] Relevant tests");
  for (const section of [
    "Scope and authority",
    "Contract and architecture",
    "Release impact",
    "Verification",
    "Knowledge and documentation",
    "Risk and recovery",
    "Checklist",
  ])
    expect(body).toContain(`## ${section}`);
  expect(body).not.toContain("pnpm check` and");
});

it("preserves user-owned PR text and refuses to overwrite unmarked or ambiguous bodies", () => {
  const coordinates = {
    repository,
    sourceRevision: revision,
    releaseRevision: "b".repeat(40),
    planId: `relprep_${"c".repeat(24)}`,
    runId: 7,
  };
  const existingBody = `${renderReleasePrBody(coordinates)}\nOwner review: preserve this decision.\n`;
  const updated = renderReleasePrBody({ ...coordinates, runId: 8, existingBody });
  expect(updated).toContain("generation run 8");
  expect(updated.endsWith("Owner review: preserve this decision.\n")).toBe(true);
  for (const body of ["User-authored proposal", existingBody + existingBody])
    expect(() => renderReleasePrBody({ ...coordinates, existingBody: body })).toThrow(
      "release_pr_body_ownership_unknown",
    );
});

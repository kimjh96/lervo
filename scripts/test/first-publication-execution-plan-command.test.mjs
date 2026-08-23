import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationExecutionPlan } from
  "../lib/cli-first-publication-execution-plan.mjs";
import { createFirstPublicationExecutionPlan } from
  "../lib/first-publication-execution-plan.mjs";
import { formatFirstPublicationExecutionPlan } from
  "../lib/first-publication-execution-plan-formatter.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function contractFiles() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-execution-plan-command-"));
  const source = createFirstPublicationFixture({ approvalId: "apr_plan_cmd" });
  const publicationAuthorizationPath = resolve(root, "publication.json");
  const bootstrapPath = resolve(root, "bootstrap.json");
  await Promise.all([
    writeFile(publicationAuthorizationPath, JSON.stringify(source.publicationAuthorization)),
    writeFile(bootstrapPath, JSON.stringify(source.bootstrap)),
  ]);
  return {
    root,
    source,
    options: { publicationAuthorizationPath, bootstrapPath },
  };
}

describe("first-publication execution plan command", () => {
  it("reads exact contract files and returns a non-armed plan", async () => {
    const prepared = await contractFiles();
    try {
      const before = await readdir(prepared.root);
      const plan = await createCliFirstPublicationExecutionPlan(prepared.options);
      assert.equal(plan.status, "not_armed");
      assert.equal(plan.activation, "not_implemented");
      assert.deepEqual(await readdir(prepared.root), before);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a contract file changed while the plan is being made", async () => {
    const prepared = await contractFiles();
    try {
      await assert.rejects(createCliFirstPublicationExecutionPlan(prepared.options, {
        createPlan: async (sources) => {
          const plan = createFirstPublicationExecutionPlan(sources);
          await writeFile(prepared.options.bootstrapPath, JSON.stringify({ changed: true }));
          return plan;
        },
      }), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("prints the canonical JSON plan and exits successfully without being armed", async () => {
    const prepared = await contractFiles();
    try {
      const result = spawnSync(process.execPath, [
        "scripts/show-cli-first-publication-execution-plan.mjs",
        "--publication-authorization", prepared.options.publicationAuthorizationPath,
        "--bootstrap", prepared.options.bootstrapPath,
        "--json",
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      const plan = JSON.parse(result.stdout);
      assert.equal(plan.status, "not_armed");
      assert.equal(plan.activation, "not_implemented");
      assert.match(plan.executionPlanDigest, /^sha256:[a-f0-9]{64}$/u);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("uses plain English to show order, cancellation, and the no-action boundary", async () => {
    const prepared = await contractFiles();
    try {
      const plan = await createCliFirstPublicationExecutionPlan(prepared.options);
      const output = formatFirstPublicationExecutionPlan(plan);
      assert.match(output, /Status: no execution authorization/u);
      assert.match(output, /1\. Revalidate execution inputs/u);
      assert.match(output, /Before reservation, cancellation causes no state change/u);
      assert.match(output, /After publication starts, it cannot be cancelled or retried immediately/u);
      assert.match(output, /did not perform online checks, request human confirmation, reserve, activate execution, or publish a package/u);
      assert.equal(output.includes(plan.executionPlanDigest), false);
      assert.equal(output.includes(prepared.options.bootstrapPath), false);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects relative, duplicate, online, and unknown arguments before reading files", () => {
    const cases = [
      ["--publication-authorization", "relative.json", "--bootstrap", "/bootstrap.json"],
      [
        "--publication-authorization", "/publication.json",
        "--publication-authorization", "/other.json",
        "--bootstrap", "/bootstrap.json",
      ],
      [
        "--publication-authorization", "/publication.json",
        "--bootstrap", "/bootstrap.json",
        "--online",
      ],
      ["--unknown"],
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, [
        "scripts/show-cli-first-publication-execution-plan.mjs",
        ...args,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_execution_plan_arguments_invalid:/u);
    }
  });

  it("does not expose malformed contract contents or paths in errors", async () => {
    const prepared = await contractFiles();
    try {
      const secret = "secret-approval-value";
      await writeFile(prepared.options.bootstrapPath, `{\"secret\":\"${secret}\"`);
      const result = spawnSync(process.execPath, [
        "scripts/show-cli-first-publication-execution-plan.mjs",
        "--publication-authorization", prepared.options.publicationAuthorizationPath,
        "--bootstrap", prepared.options.bootstrapPath,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_contract_files_invalid:/u);
      assert.equal(result.stderr.includes(secret), false);
      assert.equal(result.stderr.includes(prepared.options.bootstrapPath), false);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });
});

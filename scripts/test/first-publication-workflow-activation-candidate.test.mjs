import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  createFirstPublicationWorkflowActivationCandidate,
  stageOnlyWorkflowJobYaml,
  stagePublicationPackageScript,
  validateFirstPublicationWorkflowActivationCandidate,
} from "../lib/first-publication-workflow-activation-candidate.mjs";
import { inspectFirstPublicationStageOnlyWorkflow } from "../lib/first-publication-transition-policy.mjs";
import { canonicalDigest, sha256 } from "../lib/release-artifact-manifest.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const packagePath = resolve(repositoryRoot, "package.json");
const workflowPath = resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml");

function sourceSnapshot(contents) {
  return { contents, byteCount: contents.length, sha256: sha256(contents) };
}

async function candidateInput() {
  const [packageContents, workflowContents] = await Promise.all([
    readFile(packagePath),
    readFile(workflowPath),
  ]);
  const packageManifest = JSON.parse(packageContents.toString("utf8"));
  packageManifest.scripts["release:publication:stage"] = stagePublicationPackageScript;
  const preparedPackage = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`);
  return {
    packageManifest,
    workflow: parse(workflowContents.toString("utf8")),
    packageSnapshot: sourceSnapshot(preparedPackage),
    workflowSnapshot: sourceSnapshot(workflowContents),
  };
}

describe("first-publication stage-only workflow activation candidate", () => {
  it("inserts one exact job while preserving every original source byte", async () => {
    const input = await candidateInput();
    const before = Buffer.from(input.workflowSnapshot.contents);
    const result = createFirstPublicationWorkflowActivationCandidate(input);
    const { byteOffset } = result.candidate.insertion;
    const insertion = Buffer.from(stageOnlyWorkflowJobYaml);
    assert.deepEqual(result.outputBytes.subarray(0, byteOffset), before.subarray(0, byteOffset));
    assert.deepEqual(
      result.outputBytes.subarray(byteOffset, byteOffset + insertion.length),
      insertion,
    );
    assert.deepEqual(
      result.outputBytes.subarray(byteOffset + insertion.length),
      before.subarray(byteOffset),
    );
    assert.deepEqual(input.workflowSnapshot.contents, before);
    assert.equal(result.candidate.status, "review_required");
    assert.equal(result.candidate.sideEffects.writesAllowed, false);
    assert.equal(result.candidate.activation.directPublish, "forbidden");
    assert.equal(result.candidate.output.sha256, sha256(result.outputBytes));
    const outputWorkflow = parse(result.outputBytes.toString("utf8"));
    const job = outputWorkflow.jobs["publish-cli"];
    assert.equal(inspectFirstPublicationStageOnlyWorkflow(outputWorkflow).status, "ready");
    assert.deepEqual(job.steps.map(({ uses }) => uses).filter(Boolean), [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    ]);
    const download = job.steps.find(({ name }) => name === "Download exact release files");
    assert.deepEqual(download.with, {
      name: "lervo-cli-${{ github.ref_name }}",
      path: "${{ runner.temp }}",
    });
    assert.equal(
      job.steps.find(({ name }) => name === "Set up Node").with["node-version"],
      "22.14.0",
    );
    const upload = job.steps.find(({ name }) => name === "Upload stage publication result");
    assert.equal(upload.if, "always()");
    assert.deepEqual(upload.with, {
      name: "lervo-cli-stage-${{ github.ref_name }}-${{ github.run_attempt }}",
      path: "${{ runner.temp }}/lervo-stage-publication",
      "if-no-files-found": "warn",
      "retention-days": 30,
    });
  });

  it("inserts at the jobs boundary without moving a later top-level block", async () => {
    const input = await candidateInput();
    const contents = Buffer.from(
      `${input.workflowSnapshot.contents.toString("utf8")}post-candidate-note: keep\n`,
    );
    input.workflow = parse(contents.toString("utf8"));
    input.workflowSnapshot = sourceSnapshot(contents);
    const result = createFirstPublicationWorkflowActivationCandidate(input);
    const suffix = Buffer.from("post-candidate-note: keep\n");
    assert.deepEqual(result.outputBytes.subarray(-suffix.length), suffix);
    assert.equal(parse(result.outputBytes.toString("utf8"))["post-candidate-note"], "keep");
  });

  it("rejects a missing stage command instead of proposing a broken job", async () => {
    const input = await candidateInput();
    delete input.packageManifest.scripts["release:publication:stage"];
    const contents = Buffer.from(`${JSON.stringify(input.packageManifest, null, 2)}\n`);
    input.packageSnapshot = sourceSnapshot(contents);
    assert.throws(() => createFirstPublicationWorkflowActivationCandidate(input), {
      code: "first_publication_workflow_activation_stage_command_missing",
    });
  });

  it("rejects an active or unsafe publication workflow", async () => {
    for (const job of [
      { id: "unsafe-publish", value: { steps: [{ run: "npm publish package.tgz" }] } },
      { id: "publish-cli", value: { environment: "npm-release", steps: [] } },
    ]) {
      const input = await candidateInput();
      input.workflow.jobs[job.id] = { "runs-on": "ubuntu-latest", ...job.value };
      const contents = Buffer.from(stringify(input.workflow));
      input.workflowSnapshot = sourceSnapshot(contents);
      assert.throws(() => createFirstPublicationWorkflowActivationCandidate(input), {
        code: "first_publication_workflow_activation_already_active",
      });
    }
  });

  it("rejects a source without the attested release producer", async () => {
    const input = await candidateInput();
    delete input.workflow.jobs["attested-cli"];
    const text = input.workflowSnapshot.contents
      .toString("utf8")
      .replace(/\n {2}attested-cli:[\s\S]*$/u, "\n");
    input.workflowSnapshot = sourceSnapshot(Buffer.from(text));
    assert.throws(() => createFirstPublicationWorkflowActivationCandidate(input), {
      code: "first_publication_workflow_activation_candidate_invalid",
    });
  });

  it("rejects stale snapshot metadata and non-LF source formatting", async () => {
    const stale = await candidateInput();
    stale.workflowSnapshot.byteCount += 1;
    assert.throws(() => createFirstPublicationWorkflowActivationCandidate(stale), {
      code: "first_publication_workflow_activation_candidate_invalid",
    });
    const crlf = await candidateInput();
    const contents = Buffer.from(
      crlf.workflowSnapshot.contents.toString("utf8").replaceAll("\n", "\r\n"),
    );
    crlf.workflow = parse(contents.toString("utf8"));
    crlf.workflowSnapshot = sourceSnapshot(contents);
    assert.throws(() => createFirstPublicationWorkflowActivationCandidate(crlf), {
      code: "first_publication_workflow_activation_source_format_unsupported",
    });
  });

  it("rejects redigested write authority and changed output bytes", async () => {
    const input = await candidateInput();
    const promoted = createFirstPublicationWorkflowActivationCandidate(input);
    promoted.candidate.sideEffects.writesAllowed = true;
    const { candidateDigest: _old, ...body } = promoted.candidate;
    promoted.candidate.candidateDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationWorkflowActivationCandidate(promoted, input), {
      code: "first_publication_workflow_activation_candidate_invalid",
    });
    const changed = createFirstPublicationWorkflowActivationCandidate(input);
    changed.outputBytes = Buffer.from("name: changed\n");
    assert.throws(() => validateFirstPublicationWorkflowActivationCandidate(changed, input), {
      code: "first_publication_workflow_activation_candidate_invalid",
    });
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { verificationSuiteHash } from "@lervo/verification";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { operatingContractHash } from "@lervo/work-controller";
import { installationFixture, supervisionId } from "../../cli/test/mandate-installation.fixture.js";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { runCli } from "../../cli/src/main.js";

/** An opt-in real-provider repository: source assertions run against the actual worker checkout. */
export async function liveSupervisionFixture(
  providerExecutable: string,
  configurationDirectory: string,
  options: { publicationPreview?: boolean } = {},
) {
  const roots: string[] = [];
  const suite = {
    schemaVersion: 1 as const,
    suiteId: "role.development.artifact",
    stopOnFailure: true as const,
    commands: [
      {
        commandId: "source-preserved",
        executable: "node",
        arguments: [
          "--input-type=module",
          "-e",
          "import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('src/save.ts','utf8'),'export const saved = true;\\n');",
        ],
        cwd: ".",
        timeoutMs: 5000,
        maxOutputBytes: 4096,
        environmentVariableNames: [],
      },
    ],
  };
  const execute = promisify(execFile);
  const f = await installationFixture(
    roots,
    async (root) => {
      await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
      await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
      await mkdir(resolve(root, "src"));
      await writeFile(resolve(root, "src/save.ts"), "export const saved = true;\n");
      await writeFile(
        resolve(root, "AGENTS.md"),
        "Inspect the assigned source and report the observed exported value. Preserve all source bytes.\n",
      );
      await writeFile(
        resolve(root, ".lervo/roles/observer.json"),
        JSON.stringify({
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "observer",
          version: "1.0.0",
          extends: [{ roleId: "developer", version: "1.0.0" }],
          profile: { name: "Source observer", capabilities: { "filesystem.write": "deny" } },
          checks: [],
        }),
      );
      await writeFile(
        resolve(root, ".lervo/verifications/role.development.artifact.yaml"),
        JSON.stringify(suite),
      );
      const policy = await loadRepositoryKnowledgePolicy(root);
      policy.normalization = { exclude: ["AGENTS.md"] };
      await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
      await applyKnowledgeMigrationPlan(
        await createKnowledgeMigrationPlan({ repositoryRoot: root }),
        new Date(),
        () => undefined,
      );
      for (const args of [
        ["init"],
        ["config", "user.name", "Lervo Acceptance"],
        ["config", "user.email", "acceptance@example.invalid"],
        ["add", "src", "AGENTS.md", ".lervo/.gitignore"],
        ["commit", "-m", "Bounded source inspection acceptance"],
      ])
        await execute("git", ["-C", root, ...args]);
    },
    "observer",
  );
  const current = (await readCurrentWorkstreamState(f.root))!.snapshot;
  const desired = JSON.stringify({
    ...current,
    revision: current.revision + 1,
    title: "Verify the exported saved value",
    objective:
      "Inspect src/save.ts and report the exported saved value, including whether the exact source-preservation verification passed. Preserve all source bytes. Complete this small observation task using existing qualified staff and return the reviewed result." +
      (options.publicationPreview
        ? " Begin the accepted result with 'Lervo supervision acceptance:' and keep it under 1000 characters for the configured publication preview."
        : ""),
    nextActions: ["Inspect the source, verify preservation, and review the answer."],
    updatedAt: new Date().toISOString(),
  });
  const output: string[] = [],
    errors: string[] = [];
  const io = {
    cwd: f.root,
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => errors.push(text),
    stdin: async () => desired,
  };
  if ((await runCli(["workstream", "update", "--stdin", "--json"], io)) !== 0)
    throw new Error(errors.join(""));
  const update = JSON.parse(output.join(""));
  if (
    (await runCli(["workstream", "update", "--stdin", "--apply", update.planId, "--json"], io)) !==
    0
  )
    throw new Error(errors.join(""));
  Object.assign(f.mandate, {
    actionKinds: [
      "allocate_existing",
      "dispatch",
      "execute_as_owner",
      "request_rework",
      "retry_attempt",
      "revise_responsibility",
      ...(options.publicationPreview ? ["publish_result"] : []),
    ],
    capabilityCeiling: ["filesystem.read"],
    maximumWorkers: 1,
    maximumAttemptTokens: 100000,
    maximumAggregateTokens: 500000,
  });
  const plan = await createRepositoryMandatePlan({
    ...f,
    supervisionId,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  const installed = await installRepositoryMandate({
    root: f.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  const parent = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-live-workers-")));
  roots.push(parent);
  const baseCommit = (await execute("git", ["-C", f.root, "rev-parse", "HEAD"])).stdout.trim();
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: f.root }),
    new Date(),
    () => undefined,
  );
  return {
    roots,
    root: f.root,
    binding: {
      supervisionId,
      workstreamId: plan.source.workstreamId,
      ownerAgentId: f.owner.agentId,
      mandateHash: installed.mandateHash,
    },
    configuration: {
      providerExecutables: { codex: providerExecutable },
      providerLoginContexts: { codex: { homeDirectory: homedir(), configurationDirectory } },
      verificationSuiteHashes: { [suite.suiteId]: verificationSuiteHash(suite) },
      verificationTools: { [suite.suiteId]: [{ toolId: "node", executable: process.execPath }] },
      workerWorkspace: {
        parentDirectory: parent,
        baseCommit,
        integrationTargetDigest: operatingContractHash("live-local-source-inspection"),
      },
    },
  };
}

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const installedPortableSkillRequest = "Use the packaged repository testing workflow";
export const installedPortableSkillInstructions =
  "---\nname: installed-testing\ndescription: Use the packaged repository testing workflow.\n---\n\n# Capability skill\n\nUse the exact managed skill route.\n";

function event(trace, type) {
  return trace.events.find((item) => item.type === type);
}

async function passedVerification(runCli, cli, root, env, suffix) {
  const execution = await runCli(
    cli,
    root,
    [
      "run",
      "--provider",
      "codex",
      "--path",
      "src/result.ts",
      "--verification",
      "project.default",
      "--json",
      `Verify independent installed workflow ${suffix}`,
    ],
    {
      ...env,
      LERVO_INSTALLED_CAPABILITY_CHANGE_KIND: suffix === "a" ? "add" : "update",
      LERVO_INSTALLED_CAPABILITY_CONTENT: `export const verifiedWorkflow = ${JSON.stringify(suffix)};\n`,
      LERVO_INSTALLED_CAPABILITY_RESULT: `Independent workflow ${suffix} verified.`,
    },
  );
  const outcome = JSON.parse(execution.stdout);
  assert.equal(outcome.verificationStatus, "passed");
  const trace = JSON.parse((await runCli(cli, root, ["trace", outcome.runId, "--json"])).stdout);
  const completed = event(trace, "verification.completed");
  assert.ok(completed, `Verification evidence for workflow ${suffix} is missing.`);
  assert.equal(completed.payload.status, "passed");
  return {
    independentGroup: `installed-workflow-${suffix}`,
    eventId: completed.eventId,
    eventHash: completed.eventHash,
    runId: completed.runId,
    verificationId: completed.payload.verificationId,
    suiteHash: completed.payload.suiteHash,
    repositoryRevision: completed.payload.repositoryRevision,
    resultContentHash: completed.payload.resultContentHash,
  };
}

async function promoteCandidate(input) {
  const proposalPath = resolve(input.root, ".lervo/state/installed-portable-skill-proposal.json");
  const proposal = {
    schemaVersion: 1,
    title: "Installed repository testing workflow",
    summary: "Reuse two independently verified installed repository workflows.",
    scope: "installed repository verification",
    occurrences: [
      {
        path: "workflows/a.md",
        locator: "file:/",
        independentGroup: "installed-workflow-a",
      },
      {
        path: "workflows/b.md",
        locator: "file:/",
        independentGroup: "installed-workflow-b",
      },
    ],
    exceptions: ["Publication remains a separate authority."],
    affectedInvariants: ["Selection, activation, invocation, and completion remain distinct."],
    reasonsToChange: ["Two independent installed workflows passed exact verification."],
    verificationCommands: ["lervo run --verification project.default"],
    target: {
      kind: "portable_skill",
      path: ".agents/skills/installed-testing/SKILL.md",
      content: installedPortableSkillInstructions,
    },
    workflowVerification: input.verification,
    portableSkillContract: {
      skillId: "installed-testing",
      capabilityId: "repository/installed_testing",
      version: "1.0.0",
      supportedRoles: ["developer"],
      providerCompatibility: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.11.4",
      platforms: [process.platform],
      requiredTools: ["shell"],
      requiredCapabilities: ["filesystem.read", "shell.execute"],
      dependencies: [
        {
          capabilityId: input.dependency.capabilityId,
          version: input.dependency.version,
          contentHash: input.dependency.contentHash,
        },
      ],
      discovery: {
        displayName: "Installed repository test skill",
        summary: installedPortableSkillRequest,
        keywords: ["repository", "testing"],
        intents: [installedPortableSkillRequest],
        autoSelect: true,
      },
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
      resources: [
        {
          path: "references/checklist.md",
          content: "# Checklist\n\nRun the configured project verification and retain evidence.\n",
          purpose: "Defines the reviewed installed verification workflow.",
          required: true,
        },
      ],
    },
  };
  await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const observed = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "propose",
        "--provider",
        "codex",
        "--from",
        proposalPath,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(observed.state, "candidate");
  const reviewed = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "review",
        observed.patternId,
        "--decision",
        "accept",
        "--reviewer",
        "lervo.acceptance",
        "--approval",
        observed.candidateContentHash,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(reviewed.state, "reviewed");
  const promotion = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "promote",
        observed.patternId,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(promotion.status, "ready");
  const receipt = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "promote",
        observed.patternId,
        "--apply",
        "--approval",
        promotion.planId,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(receipt.changedFiles, 4);
  return { patternId: observed.patternId, candidateContentHash: observed.candidateContentHash };
}

async function authorizeAndMigrate(input) {
  const planPath = resolve(input.root, ".lervo/state/installed-skill-authorization-plan.json");
  const plan = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "capability",
        "authorize-skill",
        "--skill",
        "installed-testing",
        "--reviewer",
        "lervo.acceptance",
        "--json",
      ])
    ).stdout,
  );
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const authorized = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "capability",
        "authorize-skill",
        "--from",
        planPath,
        "--apply",
        "--approval",
        plan.planId,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(authorized.status, "applied");
  const migration = JSON.parse(
    (await input.runCli(input.cli, input.root, ["capability", "migrate", "--json"])).stdout,
  );
  assert.equal(migration.status, "ready");
  assert.ok(migration.items.some((item) => item.capabilityId === "repository/installed_testing"));
  const migrated = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "capability",
        "migrate",
        "--apply",
        "--approval",
        migration.planId,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(migrated.status, "current");
  return { authorizationPlanId: plan.planId, contentHash: authorized.contentHash };
}

export async function prepareInstalledPortableSkillCandidate(input) {
  await mkdir(resolve(input.root, "workflows"), { recursive: true });
  await Promise.all([
    writeFile(resolve(input.root, "workflows/a.md"), "# Workflow A\n\nRun the project check.\n"),
    writeFile(resolve(input.root, "workflows/b.md"), "# Workflow B\n\nRun the project check.\n"),
  ]);
  const verification = [];
  for (const suffix of ["a", "b"])
    verification.push(
      await passedVerification(input.runCli, input.cli, input.root, input.env, suffix),
    );
  const candidate = await promoteCandidate({ ...input, verification });
  const authorization = await authorizeAndMigrate(input);
  return {
    manifest: { capabilityId: "repository/installed_testing" },
    skill: { skillId: "installed-testing", contentHash: authorization.contentHash },
    verification,
    ...candidate,
    ...authorization,
  };
}

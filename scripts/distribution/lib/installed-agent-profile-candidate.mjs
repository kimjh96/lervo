import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const installedAgentProfileId = "installed-developer";

function roleSource() {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: installedAgentProfileId,
      version: "1.0.0",
      extends: [{ roleId: "developer", version: "1.0.0" }],
      profile: {
        name: "Installed Developer",
        description: "Uses an exact evidence-reviewed installed development profile.",
        requestTypes: ["implementation.installed"],
      },
      checks: [],
    },
    null,
    2,
  )}\n`;
}

async function invoke(input, args) {
  return JSON.parse((await input.runCli(input.cli, input.root, args)).stdout);
}

export async function activateInstalledAgentProfileCandidate(input) {
  const proposalPath = resolve(input.root, ".lervo/state/installed-agent-profile-proposal.json");
  await writeFile(
    proposalPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        title: "Installed developer profile",
        summary: "Create a repository role from two independently verified managed runs.",
        scope: "installed repository role profile",
        occurrences: ["a", "b"].map((suffix) => ({
          path: `workflows/${suffix}.md`,
          locator: "file:/",
          independentGroup: `installed-workflow-${suffix}`,
        })),
        exceptions: ["Built-in roles remain unchanged."],
        affectedInvariants: ["Managed role contracts remain exact-version and hash bound."],
        reasonsToChange: ["Two distinct installed managed runs passed exact verification."],
        verificationCommands: ["lervo role validate --role installed-developer"],
        target: {
          kind: "agent_profile",
          path: `.lervo/roles/${installedAgentProfileId}.json`,
          content: roleSource(),
          expectedCurrentHash: null,
        },
        agentProfileEvidence: input.roleProfileEvidence.slice(0, 2),
      },
      null,
      2,
    )}\n`,
  );
  const candidate = await invoke(input, [
    "role",
    "candidate",
    "propose",
    "--provider",
    "codex",
    "--from",
    proposalPath,
    "--json",
  ]);
  assert.equal(candidate.state, "candidate");
  const reviewed = await invoke(input, [
    "role",
    "candidate",
    "review",
    candidate.patternId,
    "--decision",
    "accept",
    "--reviewer",
    "lervo.acceptance",
    "--approval",
    candidate.candidateContentHash,
    "--json",
  ]);
  assert.equal(reviewed.state, "reviewed");
  const plan = await invoke(input, [
    "role",
    "candidate",
    "activate",
    candidate.patternId,
    "--json",
  ]);
  assert.equal(plan.status, "ready");
  const receipt = await invoke(input, [
    "role",
    "candidate",
    "activate",
    candidate.patternId,
    "--apply",
    "--approval",
    plan.planId,
    "--json",
  ]);
  assert.equal(receipt.changedFiles, 1);
  const validated = await invoke(input, [
    "role",
    "validate",
    "--role",
    installedAgentProfileId,
    "--json",
  ]);
  assert.equal(validated.valid, true);
  return { patternId: candidate.patternId };
}

export async function rollbackInstalledAgentProfileCandidate(input) {
  const plan = await invoke(input, ["role", "candidate", "rollback", input.patternId, "--json"]);
  assert.equal(plan.status, "ready");
  await invoke(input, [
    "role",
    "candidate",
    "rollback",
    input.patternId,
    "--apply",
    "--approval",
    plan.planId,
    "--json",
  ]);
  const status = await invoke(input, ["role", "candidate", "status", input.patternId, "--json"]);
  assert.equal(status.patterns[0].state, "rolled_back");
}

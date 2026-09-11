import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function event(trace, type) {
  return trace.events.find((item) => item.type === type);
}

async function passedVerification(input, suffix) {
  let execution;
  try {
    execution = await input.runCli(
      input.cli,
      input.root,
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
        ...input.env,
        LERVO_INSTALLED_CAPABILITY_CHANGE_KIND: suffix === "a" ? "add" : "update",
        LERVO_INSTALLED_CAPABILITY_CONTENT: `export const verifiedWorkflow = ${JSON.stringify(suffix)};\n`,
        LERVO_INSTALLED_CAPABILITY_RESULT: `Independent workflow ${suffix} verified.`,
      },
    );
  } catch (error) {
    const trace = await input.runCli(input.cli, input.root, ["trace", "last", "--full", "--json"]);
    const debugPath = input.env.LERVO_INSTALLED_CAPABILITY_DEBUG_LOG;
    const debug =
      typeof debugPath === "string"
        ? await readFile(debugPath, "utf8").catch(() => "No fixture debug output.\n")
        : "No fixture debug path.\n";
    error.message = `${error.message}\nFixture debug:\n${debug}\nInstalled verification trace:\n${trace.stdout}`;
    throw error;
  }
  const outcome = JSON.parse(execution.stdout);
  assert.equal(outcome.verificationStatus, "passed");
  const trace = JSON.parse(
    (await input.runCli(input.cli, input.root, ["trace", outcome.runId, "--full", "--json"]))
      .stdout,
  );
  const completed = event(trace, "verification.completed");
  const activation = event(trace, "role.profile.activated");
  assert.ok(completed, `Verification evidence for workflow ${suffix} is missing.`);
  assert.ok(activation, `Role-profile activation for workflow ${suffix} is missing.`);
  assert.equal(completed.payload.status, "passed");
  return {
    evidence: {
      independentGroup: `installed-workflow-${suffix}`,
      eventId: completed.eventId,
      eventHash: completed.eventHash,
      runId: completed.runId,
      verificationId: completed.payload.verificationId,
      suiteHash: completed.payload.suiteHash,
      repositoryRevision: completed.payload.repositoryRevision,
      resultContentHash: completed.payload.resultContentHash,
    },
    activation: {
      eventId: activation.eventId,
      eventHash: activation.eventHash,
      runId: activation.runId,
      provider: activation.payload.provider,
      roleId: activation.payload.roleId,
      roleVersion: activation.payload.roleVersion,
      roleContractHash: activation.payload.roleContractHash,
      roleProfileHash: activation.payload.roleProfileHash,
      runtimeProfileHash: activation.payload.runtimeProfileHash,
    },
    occurredAt: completed.occurredAt,
  };
}

export async function runInstalledVerificationBatch(input, suffixes) {
  const completed = [];
  for (const suffix of suffixes) completed.push(await passedVerification(input, suffix));
  return {
    evidence: completed.map((item) => item.evidence),
    roleProfileEvidence: completed.map((item) => ({
      independentGroup: item.evidence.independentGroup,
      activation: item.activation,
      verification: item.evidence,
    })),
    window: {
      startedAt: completed[0].occurredAt,
      endedAt: completed.at(-1).occurredAt,
    },
  };
}

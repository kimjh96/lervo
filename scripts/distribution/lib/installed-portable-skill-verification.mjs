import assert from "node:assert/strict";

function event(trace, type) {
  return trace.events.find((item) => item.type === type);
}

async function passedVerification(input, suffix) {
  const execution = await input.runCli(
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
  const outcome = JSON.parse(execution.stdout);
  assert.equal(outcome.verificationStatus, "passed");
  const trace = JSON.parse(
    (await input.runCli(input.cli, input.root, ["trace", outcome.runId, "--json"])).stdout,
  );
  const completed = event(trace, "verification.completed");
  assert.ok(completed, `Verification evidence for workflow ${suffix} is missing.`);
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
    occurredAt: completed.occurredAt,
  };
}

export async function runInstalledVerificationBatch(input, suffixes) {
  const completed = [];
  for (const suffix of suffixes) completed.push(await passedVerification(input, suffix));
  return {
    evidence: completed.map((item) => item.evidence),
    window: {
      startedAt: completed[0].occurredAt,
      endedAt: completed.at(-1).occurredAt,
    },
  };
}

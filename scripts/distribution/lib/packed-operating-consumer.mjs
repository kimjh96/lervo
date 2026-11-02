import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyPackedHandoffJourney } from "./packed-handoff-consumer.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedOperatingConsumer(consumerRoot, runCli) {
  const initialAgents = parsed(await runCli(["agent", "list", "--json"]));
  assert.equal(initialAgents.schemaVersion, 1);
  assert.deepEqual(initialAgents.agents, []);
  const agent = parsed(
    await runCli([
      "agent",
      "hire",
      "--role",
      "developer",
      "--provider",
      "any",
      "--scope",
      "operating-fixture.txt",
      "--write",
      "--json",
    ]),
  );
  assert.equal(agent.status, "active");
  const agentId = agent.agentId;
  const recipient = parsed(
    await runCli([
      "agent",
      "hire",
      "--role",
      "writer",
      "--provider",
      "any",
      "--scope",
      "operating-fixture.txt",
      "--write",
      "--json",
    ]),
  );
  assert.equal(recipient.status, "active");

  const draft = {
    schemaVersion: 1,
    status: "active",
    title: "Packed operating acceptance",
    objective: "Prove workforce, attention, and handoff commands through the installed CLI only.",
    nextActions: ["Inspect the operating attention report."],
    blockers: [],
    notes: ["The fixture grants no provider, Hub, or connector authority."],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
  const draftPath = resolve(consumerRoot, "operating-workstream.json");
  await writeFile(draftPath, `${JSON.stringify(draft)}\n`, "utf8");
  const startPlan = parsed(await runCli(["workstream", "start", "--from", draftPath, "--json"]));
  assert.equal(startPlan.status, "ready");
  const workstream = parsed(
    await runCli([
      "workstream",
      "start",
      "--from",
      draftPath,
      "--apply",
      startPlan.planId,
      "--json",
    ]),
  );
  assert.equal(workstream.status, "active");

  // Stage observations use the v2 event envelope. The acceptance fixture
  // deliberately exercises rollback above, then re-enables v2 here so a
  // cross-platform hook failure leaves bounded diagnostic evidence instead
  // of collapsing to an indistinguishable empty hook response.
  const eventEvidence = parsed(await runCli(["event-contract", "evidence", "--json"]));
  const eventEvidencePath = resolve(consumerRoot, "operating-event-reader-evidence.json");
  await writeFile(eventEvidencePath, `${JSON.stringify(eventEvidence)}\n`, "utf8");
  const eventActivationPlan = parsed(
    await runCli(["event-contract", "activate", "--from", eventEvidencePath, "--json"]),
  );
  assert.equal(eventActivationPlan.status, "ready");
  const eventActivation = parsed(
    await runCli([
      "event-contract",
      "activate",
      "--from",
      eventEvidencePath,
      "--apply",
      eventActivationPlan.planId,
      "--json",
    ]),
  );
  assert.equal(eventActivation.selectedEventSchemaVersion, 2);

  const heartbeat = parsed(
    await runCli([
      "agent",
      "heartbeat",
      "--agent",
      agentId,
      "--revision",
      String(agent.revision),
      "--provider",
      "codex",
      "--session",
      "ses_packed_operating_01",
      "--write",
      "--json",
    ]),
  );
  assert.equal(heartbeat.status, "recorded");

  const providerSessionId = "packed-canonicalization-session";
  const prepared = parsed(
    await runCli(
      ["terminal", "hook", "--provider", "codex", "--contract", "2"],
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: providerSessionId,
        turn_id: "packed-canonicalization-turn",
        prompt: "Record the durable outcome for the operating fixture.",
      }),
    ),
  );
  if (prepared.hookSpecificOutput === undefined) {
    const coverage = parsed(
      await runCli(["terminal", "coverage", "--provider", "codex", "--limit", "5", "--json"]),
    );
    const providerSessionDigest = sha256(`codex\0${providerSessionId}`);
    const trace = parsed(
      await runCli([
        "trace",
        `run_unmanaged_${providerSessionDigest.slice("sha256:".length, "sha256:".length + 24)}`,
        "--json",
      ]),
    );
    assert.fail(
      `Packed terminal context was unavailable; bounded terminal coverage: ${JSON.stringify(coverage)}; bounded terminal trace: ${JSON.stringify(trace)}`,
    );
  }
  const observationId = /--observation (tobs_[A-Za-z0-9_-]+)/u.exec(
    prepared.hookSpecificOutput.additionalContext,
  )?.[1];
  assert.match(observationId, /^tobs_[A-Za-z0-9_-]+$/u);
  await writeFile(
    resolve(consumerRoot, "operating-fixture.ts"),
    "export const packedCanonicalization = true;\n",
    "utf8",
  );
  const declaration = parsed(
    await runCli(
      [
        "terminal",
        "declare",
        "--provider",
        "codex",
        "--observation",
        observationId,
        "--stdin",
        "--json",
      ],
      JSON.stringify({
        taskMode: "change",
        canonicalizationDisposition: "canonical_sources_current",
        canonicalizationOutcome: {
          schemaVersion: 1,
          kind: "no_durable_change",
          summary: "The packed fixture change is implementation-only.",
          reasonCode: "implementation_only",
          sourcePaths: ["operating-fixture.ts"],
        },
        // ADR-0561: remaining lifecycle work is Lervo's background work, never an owner wait.
        knowledgeDisposition: "pending_background",
        deliberationDisposition: "not_requested",
        deliberationId: null,
      }),
    ),
  );
  assert.equal(declaration.status, "declared");
  assert.equal(declaration.canonicalizationAssessment.status, "candidate");
  const canonicalizationCandidate = declaration.canonicalizationAssessment.candidate;
  assert.equal(canonicalizationCandidate.outcome.kind, "no_durable_change");
  const candidateStatus = parsed(
    await runCli([
      "knowledge",
      "canonicalization",
      "status",
      canonicalizationCandidate.candidateId,
      "--json",
    ]),
  );
  assert.equal(candidateStatus.candidates[0].contentHash, canonicalizationCandidate.contentHash);

  const assignment = parsed(
    await runCli([
      "assignment",
      "create",
      "--type",
      "operating_acceptance",
      "--role",
      "developer",
      "--criteria",
      "Hand off the canonical assignment between hired agents.",
      "--suite",
      "project.quick",
      "--path",
      "operating-fixture.txt",
      "--workstream",
      workstream.workstreamId,
      "--write",
      "--json",
    ]),
  );
  assert.equal(assignment.status, "queued");
  const assignments = parsed(await runCli(["assignment", "list", "--json"]));
  assert.deepEqual(
    assignments.assignments.map((item) => item.assignmentId),
    [assignment.assignmentId],
  );

  const attention = parsed(await runCli(["application", "attention", "--json"]));
  assert.equal(attention.schemaVersion, 1);
  assert.equal(attention.kind, "operating_attention.report");
  assert.equal(attention.workstream.workstreamId, workstream.workstreamId);
  assert.equal(attention.coverage.workstream, "current");
  assert.equal(attention.coverage.canonicalization, "complete");
  assert.equal(attention.coverage.knowledgeLifecycle, "complete");
  assert.match(attention.reportDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    attention.limitations.includes(
      "This report is a read-only projection and grants no review, approval, write, provider, or external-effect authority.",
    ),
    true,
  );
  assert.equal(
    attention.items.some(
      (item) =>
        item.itemId === canonicalizationCandidate.candidateId &&
        item.outcomeKind === "no_durable_change" &&
        // ADR-0561: the background canonical reviewer owns every candidate; the owner never does.
        item.actionOwner === "reviewer" &&
        item.requiresUserAction === false,
    ),
    true,
  );

  const handoffId = await verifyPackedHandoffJourney({
    runCli,
    assignmentId: assignment.assignmentId,
    sourceAgentId: agentId,
    recipientAgentId: recipient.agentId,
  });

  return {
    workstreamId: workstream.workstreamId,
    assignmentId: assignment.assignmentId,
    handoffId,
  };
}

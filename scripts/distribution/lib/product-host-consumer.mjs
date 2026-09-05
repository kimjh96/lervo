import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyPackedProductHostCapabilities } from "./product-host-capability-consumer.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedProductHostConsumer(consumerRoot, runCli) {
  const capabilities = await verifyPackedProductHostCapabilities(runCli);

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
      "product-host-fixture.txt",
      "--write",
      "--json",
    ]),
  );
  assert.equal(agent.status, "active");
  const agentId = agent.agentId;

  const draft = {
    schemaVersion: 1,
    status: "active",
    title: "Packed product-host acceptance",
    objective: "Prove operating and collaboration routes through the installed CLI only.",
    nextActions: ["Inspect the external product-host projection."],
    blockers: [],
    notes: ["The fixture grants no provider, Hub, or connector authority."],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
  const draftPath = resolve(consumerRoot, "product-host-workstream.json");
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
  const eventEvidencePath = resolve(consumerRoot, "product-host-event-reader-evidence.json");
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
      "ses_packed_product_host_01",
      "--write",
      "--json",
    ]),
  );
  assert.equal(heartbeat.status, "recorded");
  const liveness = parsed(await runCli(["application", "liveness", "--json"]));
  assert.equal(liveness.kind, "operating_liveness.report");
  assert.equal(liveness.rootAgents.items.length, 1);
  assert.equal(liveness.rootAgents.items[0].agentId, agentId);
  assert.equal(liveness.rootAgents.items[0].status, "recently_observed");
  assert.equal(liveness.rootAgents.items[0].provesManagedProcessHealth, false);
  assert.deepEqual(liveness.managedProviderProcesses.items, []);
  assert.equal(liveness.authority.startsOrStopsProvider, false);

  const providerSessionId = "packed-canonicalization-session";
  const prepared = parsed(
    await runCli(
      ["terminal", "hook", "--provider", "codex", "--contract", "2"],
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: providerSessionId,
        turn_id: "packed-canonicalization-turn",
        prompt: "Record the durable outcome for the product-host fixture.",
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
    resolve(consumerRoot, "product-host-fixture.ts"),
    "export const packedCanonicalization = true;\n",
    "utf8",
  );
  const proposedMarkdown =
    "# Product-host fixture\n\nThe packed canonicalization fixture is enabled.\n";
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
        canonicalizationDisposition: "pending_user_approval",
        canonicalizationOutcome: {
          schemaVersion: 1,
          kind: "review_draft",
          summary: "The packed fixture proposes a durable specification update.",
          drafts: [
            {
              targetPath: "docs/specs/product-host-fixture.md",
              sourcePaths: ["product-host-fixture.ts"],
              proposedMarkdown,
              proposedContentHash: sha256(proposedMarkdown),
            },
          ],
        },
        knowledgeDisposition: "pending_user_approval",
        deliberationDisposition: "not_requested",
        deliberationId: null,
      }),
    ),
  );
  assert.equal(declaration.status, "declared");
  assert.equal(declaration.canonicalizationAssessment.status, "pending");
  const canonicalizationCandidate = declaration.canonicalizationAssessment.candidate;
  assert.equal(canonicalizationCandidate.outcome.kind, "review_draft");
  assert.deepEqual(canonicalizationCandidate.outcome.drafts[0], {
    targetPath: "docs/specs/product-host-fixture.md",
    sourcePaths: ["product-host-fixture.ts"],
    proposedMarkdown,
    proposedContentHash: sha256(proposedMarkdown),
  });
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
      "product_host_acceptance",
      "--role",
      "developer",
      "--criteria",
      "Expose the canonical assignment through the product-host projection.",
      "--suite",
      "project.quick",
      "--path",
      "product-host-fixture.txt",
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

  const objective = parsed(await runCli(["loop", "objective", "--json"]));
  assert.equal(objective.workstreamId, workstream.workstreamId);
  assert.equal(objective.objective, draft.objective);
  const goal = parsed(await runCli(["loop", "goal", "--json"]));
  assert.equal(goal.kind, "operating_goal.report");
  assert.equal(goal.goal.goalId, workstream.workstreamId);
  assert.equal(goal.hierarchy.kind, "workstream_assignment_dag");
  assert.deepEqual(
    goal.hierarchy.graph.nodes.map((node) => node.assignmentId),
    [assignment.assignmentId],
  );
  assert.equal(goal.completion.status, "active");
  assert.deepEqual(goal.authority, {
    createsGoal: false,
    changesWorkstream: false,
    changesAssignments: false,
    startsProvider: false,
  });

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
        item.outcomeKind === "review_draft" &&
        item.hasProposedContent === true &&
        item.requiresUserAction === true,
    ),
    true,
  );
  await mkdir(resolve(consumerRoot, "docs/specs"), { recursive: true });
  await writeFile(
    resolve(consumerRoot, "docs/specs/product-host-fixture.md"),
    proposedMarkdown,
    "utf8",
  );
  const promotedCandidate = parsed(
    await runCli([
      "knowledge",
      "canonicalization",
      "promote",
      canonicalizationCandidate.candidateId,
      "--target",
      "docs/specs/product-host-fixture.md",
      "--target-hash",
      sha256(proposedMarkdown),
      "--reviewer",
      "packed.fixture",
      "--approval",
      canonicalizationCandidate.contentHash,
      "--json",
    ]),
  );
  assert.equal(promotedCandidate.observedState, "promoted");
  assert.equal(promotedCandidate.promotion.targetPath, "docs/specs/product-host-fixture.md");
  const attentionAfterPromotion = parsed(await runCli(["application", "attention", "--json"]));
  assert.equal(
    attentionAfterPromotion.items.some(
      (item) => item.itemId === canonicalizationCandidate.candidateId,
    ),
    false,
  );

  const governedWork = parsed(await runCli(["loop", "status", "--json"]));
  assert.equal(governedWork.workstreamId, workstream.workstreamId);
  assert.deepEqual(
    governedWork.graph.nodes.map((node) => node.assignmentId),
    [assignment.assignmentId],
  );
  assert.equal(governedWork.decision.status, "ready");
  assert.equal(governedWork.decision.actions[0].kind, "claim_assignment");

  const budgets = parsed(await runCli(["loop", "budget", "--json"]));
  assert.deepEqual(budgets, []);

  const thread = parsed(
    await runCli(["loop", "thread", "--assignment", assignment.assignmentId, "--json"]),
  );
  assert.equal(thread.validity.status, "valid");
  assert.equal(thread.threads[0].assignmentId, assignment.assignmentId);
  assert.deepEqual(thread.threads[0].routes, []);

  const inbox = parsed(await runCli(["loop", "inbox", "--agent", agentId, "--json"]));
  assert.equal(inbox.validity.status, "valid");
  assert.deepEqual(inbox.inbox, []);

  const board = await runCli(["loop", "board"]);
  assert.equal(board.stderr, "");
  assert.match(board.stdout, /^<!doctype html>/u);
  assert.equal(board.stdout.includes("Projection, not authority"), true);
  assert.equal(board.stdout.includes(assignment.assignmentId), true);

  return {
    protocolVersion: capabilities.protocol.version,
    routeCount: capabilities.routes.length,
    workforceRouteCount: capabilities.routes.filter((route) => route.area === "workforce").length,
    operatingRouteCount: capabilities.routes.filter((route) => route.area === "operating").length,
    collaborationRouteCount: capabilities.routes.filter((route) => route.area === "collaboration")
      .length,
  };
}

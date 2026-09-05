import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedProductHostMessageJourney(input) {
  const claimed = parsed(
    await input.runCli([
      "assignment",
      "claim",
      "--assignment",
      input.assignmentId,
      "--agent",
      input.sourceAgentId,
      "--session",
      "ses_packed_message_trigger_01",
      "--write",
      "--json",
    ]),
  );
  const request = {
    schemaVersion: 1,
    adapterId: "lervo/reviewed-message-file",
    assignmentId: input.assignmentId,
    leaseId: claimed.lease.leaseId,
    source: {
      schemaVersion: 1,
      kind: "direct_message",
      eventId: `cve_${"7".repeat(64)}`,
      sourceEventKeyHash: sha256("packed-product-host-message-source"),
      projectId: input.projectId,
      workstreamId: input.workstreamId,
      fromAgentId: input.sourceAgentId,
      toAgentId: input.recipientAgentId,
      content: {
        artifactId: "art_packed_message_01",
        contentHash: sha256("packed product-host direct message"),
      },
      occurredAt: "2026-09-03T00:01:00.000Z",
    },
    contextEvidenceEventIds: [],
  };
  const requestPath = resolve(input.consumerRoot, "product-host-message-trigger.json");
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");
  const triggerArgs = ["assignment", "trigger", "--from", requestPath];
  const triggerPlan = parsed(await input.runCli([...triggerArgs, "--json"]));
  assert.equal(triggerPlan.plan.status, "ready");
  assert.equal(triggerPlan.plan.sourceEventId, request.source.eventId);
  const triggered = parsed(
    await input.runCli([...triggerArgs, "--apply", triggerPlan.plan.planId, "--write", "--json"]),
  );
  assert.match(triggered.handoffId, /^hnd_[a-f0-9]{24}$/u);
  const triggerReplay = parsed(await input.runCli([...triggerArgs, "--json"]));
  assert.equal(triggerReplay.plan.status, "current");
  assert.equal(triggerReplay.handoffId, triggered.handoffId);

  const acknowledged = parsed(
    await input.runCli([
      "assignment",
      "acknowledge",
      "--assignment",
      input.assignmentId,
      "--handoff",
      triggered.handoffId,
      "--agent",
      input.recipientAgentId,
      "--write",
      "--json",
    ]),
  );
  assert.equal(acknowledged.handoff.toAgentId, input.recipientAgentId);
  assert.match(acknowledged.handoff.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T/u);
  const thread = parsed(
    await input.runCli([
      "loop",
      "thread",
      "--contract",
      "2",
      "--assignment",
      input.assignmentId,
      "--json",
    ]),
  );
  assert.equal(thread.threads[0].routes[0].deliveryState, "unobserved");
  assert.equal(thread.threads[0].routes[0].acknowledgementState, "recorded");
  assert.equal(thread.threads[0].routes[0].trigger.sourceEventId, request.source.eventId);
}

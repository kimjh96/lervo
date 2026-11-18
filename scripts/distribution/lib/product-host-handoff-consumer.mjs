import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedProductHostHandoffJourney(input) {
  const claimed = parsed(
    await input.runCli([
      "assignment",
      "claim",
      "--assignment",
      input.assignmentId,
      "--agent",
      input.sourceAgentId,
      "--session",
      "ses_packed_handoff_01",
      "--write",
      "--json",
    ]),
  );
  const recorded = parsed(
    await input.runCli([
      "assignment",
      "handoff",
      "--assignment",
      input.assignmentId,
      "--from-agent",
      input.sourceAgentId,
      "--to-agent",
      input.recipientAgentId,
      "--lease",
      claimed.lease.leaseId,
      "--request-digest",
      sha256("packed product-host handoff request"),
      "--artifact",
      `art_packed_handoff_01=${sha256("packed product-host handoff artifact")}`,
      "--write",
      "--json",
    ]),
  );
  const handoffId = recorded.handoffs.at(-1).handoffId;
  assert.match(handoffId, /^hnd_[a-f0-9]{24}$/u);

  const acknowledged = parsed(
    await input.runCli([
      "assignment",
      "acknowledge",
      "--assignment",
      input.assignmentId,
      "--handoff",
      handoffId,
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
}

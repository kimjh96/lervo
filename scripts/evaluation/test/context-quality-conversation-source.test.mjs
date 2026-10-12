import { expect, it } from "vitest";
import {
  assertConversationInboundEvent,
  createConversationInboundEvent,
} from "@lervo/conversation-contract";
import { digest } from "../lib/context-quality-artifact-identity.mjs";
import {
  createConversationSourceReport,
  conversationSourceLimits,
} from "../lib/context-quality-conversation-source-report.mjs";
import { auditConversationSources } from "../lib/context-quality-conversation-source-reader.mjs";

const projectId = "prj_project01",
  integrationId = "itg_native001";
function fixture(
  bytes = Buffer.from("private original task body"),
  key = "source",
  overrides = {},
) {
  const event = createConversationInboundEvent({
    sourceEventKeyHash: digest(key),
    target: { integrationId, projectId, conversationId: "cnv_general01", threadId: null },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_human001", roleId: null },
    content: {
      artifactId: `art_${digest(bytes).slice(7)}`,
      contentHash: digest(bytes),
      byteCount: bytes.length,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: [], participantIds: [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
  return {
    bytes,
    event,
    row: {
      event_id: event.eventId,
      project_id: projectId,
      integration_id: integrationId,
      conversation_id: event.target.conversationId,
      event_json: JSON.stringify(event),
    },
  };
}
const audit = () =>
  createConversationSourceReport(projectId, [integrationId], assertConversationInboundEvent);

it("verifies source bodies without emitting text or promoting messages into reviewed families", () => {
  const a = audit(),
    f = fixture();
  a.observeBody(a.observe(f.row, integrationId), f.bytes);
  const other = fixture(f.bytes, "different source");
  a.observeBody(a.observe(other.row, integrationId), other.bytes);
  const result = a.finish();
  expect(result).toMatchObject({
    normalizedHumanEvents: 2,
    verifiedHumanBodies: 2,
    uniqueHumanBodyDigests: 1,
    qualifiedFamilies: 0,
    reviewedLabelSets: 0,
    heldOutFamilies: 0,
    privateBodiesEmitted: false,
  });
  expect(JSON.stringify(result)).not.toContain(f.bytes.toString());
  expect(JSON.stringify(result)).not.toContain("ptc_human001");
});
it("deduplicates canonically identical copies independent of JSON property order", () => {
  const a = audit(),
    f = fixture();
  a.observeBody(a.observe(f.row, integrationId), f.bytes);
  const reordered = Object.fromEntries(Object.entries(f.event).reverse());
  expect(a.observe({ ...f.row, event_json: JSON.stringify(reordered) }, integrationId)).toBeNull();
  expect(a.finish()).toMatchObject({
    duplicateEventCopies: 1,
    uniqueValidatedEvents: 1,
    verifiedHumanBodies: 1,
  });
});
it("rejects stale identities and cross-project row bindings without counting them as human sources", () => {
  const a = audit(),
    f = fixture();
  expect(a.observe({ ...f.row, project_id: "prj_foreign01" }, integrationId)).toBeNull();
  expect(
    a.observe(
      { ...f.row, event_json: JSON.stringify({ ...f.event, automationDepth: 1 }) },
      integrationId,
    ),
  ).toBeNull();
  expect(a.finish()).toMatchObject({
    invalidRows: 2,
    normalizedHumanEvents: 0,
    uniqueValidatedEvents: 0,
  });
});
it.each(["missing", "wrong_digest", "invalid_utf8", "oversized"])(
  "reports %s bodies unavailable",
  (kind) => {
    const a = audit(),
      f = fixture(kind === "invalid_utf8" ? Buffer.from([255]) : undefined);
    const event = a.observe(f.row, integrationId);
    a.observeBody(
      event,
      kind === "missing"
        ? null
        : kind === "wrong_digest"
          ? Buffer.from("other")
          : kind === "oversized"
            ? Buffer.alloc(65537)
            : f.bytes,
    );
    expect(a.finish()).toMatchObject({ verifiedHumanBodies: 0, unavailableHumanBodies: 1 });
  },
);
it("keeps nonhuman events separate and counts only observed reply links", () => {
  const a = audit(),
    system = fixture(Buffer.from("system"), "system", {
      actor: { kind: "system", participantId: "ptc_system01", roleId: null },
    });
  expect(a.observe(system.row, integrationId)).toBeNull();
  const human = fixture(Buffer.from("human"), "human", { replyToEventId: system.event.eventId });
  a.observeBody(a.observe(human.row, integrationId), human.bytes);
  expect(a.finish()).toMatchObject({
    uniqueValidatedEvents: 2,
    normalizedHumanEvents: 1,
    humanReplyLinks: 1,
    humanRepliesResolvedInObservedInbox: 1,
  });
});
it("cannot finish with unchecked bodies or count a body twice", () => {
  const a = audit(),
    f = fixture();
  const event = a.observe(f.row, integrationId);
  expect(() => a.finish()).toThrow("incomplete");
  a.observeBody(event, f.bytes);
  expect(() => a.observeBody(event, f.bytes)).toThrow("repeated");
  expect(a.finish().verifiedHumanBodies).toBe(1);
});
it("fails at the registered row bound rather than returning a complete truncated audit", () => {
  const a = audit();
  for (let i = 0; i < conversationSourceLimits.maximumRows; i++)
    a.observe({ event_json: "{}" }, integrationId);
  expect(() => a.observe({ event_json: "{}" }, integrationId)).toThrow("bound");
});
it("rejects an unsafe or duplicate integration selector before reading repository files", async () => {
  await expect(auditConversationSources("/unused", ["../private"])).rejects.toThrow("integration");
  await expect(auditConversationSources("/unused", [integrationId, integrationId])).rejects.toThrow(
    "integration",
  );
});

it("bounds total metadata bytes independently of row count", () => {
  const a = audit(),
    row = { event_json: " ".repeat(1024 * 1024) };
  expect(() => {
    for (let i = 0; i < 80; i++) a.observe(row, integrationId);
  }).toThrow("metadata bound");
});

it("compares timestamp instants rather than their original timezone spelling", () => {
  const a = audit();
  for (const occurredAt of ["2026-10-01T00:00:00.000+09:00", "2026-09-30T20:00:00.000Z"]) {
    const f = fixture(Buffer.from("private"), occurredAt, { occurredAt });
    a.observeBody(a.observe(f.row, integrationId), f.bytes);
  }
  expect(a.finish().humanTimeRange).toEqual([
    "2026-09-30T15:00:00.000Z",
    "2026-09-30T20:00:00.000Z",
  ]);
});

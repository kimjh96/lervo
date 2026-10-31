import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { appendPracticeEvent } from "../src/practice-events.js";
import { practiceContext } from "./practice-fixture.js";
import { validateSchema } from "@lervo/schemas";
import { createEventWriterActivationPlan, defaultEventWriterCoordinate } from "@lervo/project";

const payload = {
  candidateId: "kpc_" + "a".repeat(24),
  practiceDigest: sha256("practice"),
  workDigests: [sha256("work")],
  overlap: "new",
  targetSkill: null,
  draftHash: sha256("draft"),
  occurredAt: "2026-10-31T12:00:00Z",
};
describe("schema 8 practice writer activation", () => {
  it("keeps all new event types out of older readers", () => {
    const context = practiceContext("/repo");
    expect(() =>
      appendPracticeEvent(context.storage, "knowledge.skill_candidate.proposed", payload),
    ).not.toThrow();
    const append = vi.fn();
    appendPracticeEvent(
      {
        ...context.storage,
        writableEventSchemaVersion: 8,
        events: { ...context.storage.events, append },
      },
      "knowledge.skill_candidate.proposed",
      payload,
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 8,
        type: "knowledge.skill_candidate.proposed",
        payload,
      }),
    );
    expect(JSON.stringify(append.mock.calls)).not.toContain("reply");
    expect(
      validateSchema("knowledgeSkillCandidateProposedEventPayload", {
        ...payload,
        workText: "private",
      }).valid,
    ).toBe(false);
  });
  it("refuses schema 8 activation when any configured reader reports only schema 7", () => {
    expect(() =>
      createEventWriterActivationPlan({
        repositoryRoot: "/repo",
        projectId: "prj_practice_fixture",
        hubSyncEnabled: false,
        currentCoordinate: defaultEventWriterCoordinate("prj_practice_fixture"),
        currentContentHash: null,
        targetEventSchemaVersion: 8,
        evidence: {
          schemaVersion: 1,
          projectId: "prj_practice_fixture",
          observedAt: payload.occurredAt,
          readers: [
            {
              readerId: "reader_practice_fixture",
              readerKind: "local",
              peerIdentityHash: null,
              capabilities: {
                schemaVersion: 1,
                capability: "event_reader",
                readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
              },
            },
          ],
        },
      }),
    ).toThrow();
  });
});

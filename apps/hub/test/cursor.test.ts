import { describe, expect, it } from "vitest";

import {
  decodeEventCursor,
  decodeKnowledgeGraphCursor,
  decodeProjectCursor,
  decodeRunCursor,
  encodeEventCursor,
  encodeKnowledgeGraphCursor,
  encodeProjectCursor,
  encodeRunCursor,
} from "../src/cursor.js";

describe("Hub trace HTTP cursor", () => {
  it("round-trips versioned cursors without exposing raw JSON", () => {
    const project = { destinationId: "hub:primary", projectId: "prj_allowed01" };
    const run = { firstSeq: 7, runId: "run_allowed01" };
    const event = { seq: 12 };
    const graph = { relationId: "kgr_aaaaaaaaaaaaaaaa" };

    expect(decodeProjectCursor(encodeProjectCursor(project))).toEqual(project);
    expect(decodeRunCursor(encodeRunCursor(run))).toEqual(run);
    expect(decodeEventCursor(encodeEventCursor(event))).toEqual(event);
    expect(decodeKnowledgeGraphCursor(encodeKnowledgeGraphCursor(graph))).toEqual(graph);
    expect(encodeProjectCursor(project)).not.toContain("prj_allowed01");
  });

  it("rejects the wrong cursor kind, extra fields, and non-canonical encoding", () => {
    expect(() =>
      decodeRunCursor(
        encodeProjectCursor({
          destinationId: "hub:primary",
          projectId: "prj_allowed01",
        }),
      ),
    ).toThrow("cursor format");
    const extra = Buffer.from(
      JSON.stringify({
        v: 1,
        kind: "event",
        seq: 1,
        extra: true,
      }),
    ).toString("base64url");
    expect(() => decodeEventCursor(extra)).toThrow("event cursor format");
    expect(() => decodeEventCursor("not+base64url")).toThrow("cursor format");
    expect(() => decodeKnowledgeGraphCursor(encodeEventCursor({ seq: 1 }))).toThrow(
      "cursor format",
    );
  });
});

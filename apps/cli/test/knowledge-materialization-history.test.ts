import { expect, it, vi } from "vitest";
import { materializationEventRecorded } from "../src/knowledge-materialization-history.js";
it("retains terminal outputs after their canonical event beyond the first page", () => {
  const list = vi
    .fn()
    .mockReturnValueOnce(
      Array.from({ length: 1000 }, (_, i) => ({
        seq: i + 1,
        type: "terminal.context.prepared",
        payload: { planId: "target" },
      })),
    )
    .mockReturnValueOnce([
      { seq: 1001, type: "terminal.integration.applied", payload: { planId: "target" } },
    ]);
  expect(materializationEventRecorded({ list }, "target")).toBe(true);
  expect(list).toHaveBeenLastCalledWith({ afterSeq: 1000, limit: 1000 });
});
it("rejects different plans and observations while preserving semantic application recovery", () => {
  const list = vi.fn().mockReturnValue([
    { seq: 1, type: "terminal.integration.applied", payload: { planId: "other" } },
    { seq: 2, type: "terminal.context.prepared", payload: { planId: "target" } },
  ]);
  expect(materializationEventRecorded({ list }, "target")).toBe(false);
  list.mockReturnValue([
    { seq: 1, type: "knowledge.materialization.applied", payload: { planId: "target" } },
  ]);
  expect(materializationEventRecorded({ list }, "target")).toBe(true);
});

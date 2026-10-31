import { expect, it } from "vitest";
import { continuityAttentionItems } from "../src/knowledge-continuity-attention.js";

it("assigns unavailable hook runtime repair to the host resident without owner work", () => {
  const [item] = continuityAttentionItems(
    [{ code: "hook_runtime_unavailable", severity: "attention", detail: null }],
    "2026-10-31T00:00:00Z",
  );
  expect(item).toMatchObject({
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
  });
  expect(item?.instruction).toContain("resident restores");
  expect(item?.instruction).not.toContain("lervo upgrade");
});

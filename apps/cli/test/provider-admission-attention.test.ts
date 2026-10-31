import { expect, it } from "vitest";
import { continuityAttentionItems } from "../src/knowledge-continuity-attention.js";

it("attributes rejection and waiting to provider admission without requiring owner action", () => {
  const items = continuityAttentionItems(
    [
      {
        code: "provider_cli_rejected",
        severity: "attention",
        detail: "codex:0.166.0:capabilities_exposed",
        actor: "provider admission",
      },
      {
        code: "provider_not_admitted",
        severity: "attention",
        detail: null,
        actor: "provider admission",
      },
    ],
    "2026-10-31T00:00:00Z",
  );
  expect(items).toHaveLength(2);
  expect(
    items.every(
      (item) =>
        item.actor === "provider admission" &&
        item.actionOwner === "agent" &&
        !item.requiresUserAction &&
        !item.blocking,
    ),
  ).toBe(true);
});

it("keeps pause timing visible without claiming all allowed providers failed admission", () => {
  const detail =
    "claude:paused:quota:observed_at=2026-09-28T00:00:00Z:age_ms=2851200000:next_reprobe_at=2026-09-28T01:00:00Z:reset_at=null";
  const [item] = continuityAttentionItems(
    [
      {
        code: "provider_not_admitted",
        severity: "attention",
        actor: "provider admission",
        detail,
      },
    ],
    "2026-10-31T00:00:00Z",
  );
  expect(item).toMatchObject({ detail, actionOwner: "agent", requiresUserAction: false });
  expect(item?.instruction).toContain("when delegation allows that candidate");
});

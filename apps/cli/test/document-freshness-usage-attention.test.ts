import { expect, it } from "vitest";

import { documentFreshnessAttentionItems } from "../src/document-freshness-attention.js";

it("reports a provider whose freshness reviews report no usage as Lervo debt (ADR-0604)", () => {
  const empty = { held: [], applied: [], zeroSuccessHold: null, debt: [] };
  expect(documentFreshnessAttentionItems({ ...empty, usageUnavailable: null })).toEqual([]);
  const [item] = documentFreshnessAttentionItems({
    ...empty,
    usageUnavailable: {
      provider: "claude",
      count: 3,
      since: "2026-11-21T00:00:00.000Z",
      until: "2026-11-22T00:03:00.000Z",
    },
  });
  expect(item).toMatchObject({
    kind: "document_freshness_blocked",
    itemId: "document_freshness_blocked_usage_unavailable_claude",
    reasonCode: "usage_unavailable",
    attempts: 3,
    retryAt: "2026-11-22T00:03:00.000Z",
    requiresUserAction: false,
    blocking: false,
  });
  expect((item as { instruction: string }).instruction).toContain("stops paying for them");
});

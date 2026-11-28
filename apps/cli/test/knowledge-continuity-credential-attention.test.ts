import { expect, it } from "vitest";

import { continuityAttentionItems } from "../src/knowledge-continuity-attention.js";

const observedAt = "2026-11-28T06:00:00.000Z";

it("shows one notice for Hub coordinates this host has no credential for", () => {
  const [item, ...rest] = continuityAttentionItems(
    [{ code: "owner_host_hub_unusable", severity: "attention", detail: "hub_credential_absent" }],
    observedAt,
  );
  expect(rest).toEqual([]);
  expect(item).toMatchObject({
    itemId: "knowledge_convergence_continuity_owner_host_hub_unusable_hub_credential_absent",
    state: "credentials_missing",
    requiresUserAction: false,
    blocking: false,
  });
  expect(item!.instruction).toContain("nodes/<projectId>/secrets/hub-sync.token");
  expect(item!.instruction).toContain("sync.write");
  expect(item!.instruction).toContain("SIGHUP");
  expect(item!.instruction).toContain("hubSyncEnabled");
  expect(item!.instruction).not.toContain("upgrade the Hub");
});

it("keeps other unusable Hub coordinates Lervo debt it retries", () => {
  const [item] = continuityAttentionItems(
    [{ code: "owner_host_hub_unusable", severity: "attention", detail: "hub_unreachable" }],
    observedAt,
  );
  expect(item?.state).toBe("observed");
});

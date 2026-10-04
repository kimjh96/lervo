import { describe, expect, it } from "vitest";

import { enforceProviderClaim } from "../src/index.js";

const verifiedId = "dlb_verified0001";

describe("provider_claim_unproven", () => {
  it("repairs a reply that claims two providers' opinions without a verified deliberation", async () => {
    const reply = [
      "The cache layer should move behind the adapter.",
      "Codex's opinion is that the queue should stay synchronous. Claude thinks it should be async.",
      "Both agree the schema needs a version bump.",
    ].join("\n");
    const result = await enforceProviderClaim(reply, { observedProvider: "claude" });
    expect(result).toMatchObject({
      checkId: "provider_claim_unproven",
      disposition: "repaired",
      claimedProviders: ["claude", "codex"],
    });
    expect(result.content).toContain("The cache layer should move behind the adapter.");
    expect(result.content).toContain("Claude thinks it should be async.");
    expect(result.content).not.toContain("Codex");
    expect(result.content).toContain("reflects the Claude provider's view only");
  });

  it("repairs the Korean model-name form and keeps the reply language", async () => {
    const reply =
      "Sol 의견과 Opus 의견을 따로 정리했습니다. 코덱스는 동기 방식을 선호합니다. 오퍼스는 비동기 방식을 제안합니다.";
    const result = await enforceProviderClaim(reply, { observedProvider: "claude" });
    expect(result.disposition).toBe("repaired");
    expect(result.content).toContain("오퍼스는 비동기 방식을 제안합니다.");
    expect(result.content).not.toContain("코덱스");
    expect(result.content).not.toContain("Sol");
    expect(result.content).toContain("Claude 한 공급자의 관점만 반영합니다");
  });

  it("repairs a claim whose cited deliberation is not verified", async () => {
    const reply = `Codex and Claude agree on the rollout (${"dlb_unverified01"}).`;
    const result = await enforceProviderClaim(reply, {
      observedProvider: "codex",
      isVerifiedDeliberation: () => false,
    });
    expect(result.disposition).toBe("repaired");
    expect(result.citedDeliberationIds).toEqual(["dlb_unverified01"]);
    expect(result.content).not.toContain("Claude");
  });

  it("keeps a multi-provider claim that cites a verified deliberation", async () => {
    const reply = `Codex and Claude agree on the rollout (${verifiedId}).`;
    const result = await enforceProviderClaim(reply, {
      observedProvider: "codex",
      isVerifiedDeliberation: (id) => id === verifiedId,
    });
    expect(result).toMatchObject({
      disposition: "proven",
      content: reply,
      verifiedDeliberationIds: [verifiedId],
    });
  });

  it("accepts operator aliases such as a bound agent display name", async () => {
    const result = await enforceProviderClaim("Navi thinks A. Claude thinks B.", {
      observedProvider: "claude",
      aliases: { codex: ["Navi"] },
    });
    expect(result.disposition).toBe("repaired");
    expect(result.content).not.toContain("Navi");
  });

  it("does not touch single-provider or factual mentions", async () => {
    for (const reply of [
      "Claude thinks the migration is safe.",
      "The Codex and Claude adapters both emit usage events now.",
    ]) {
      const result = await enforceProviderClaim(reply, { observedProvider: "claude" });
      expect(result).toMatchObject({ disposition: "not_applicable", content: reply });
    }
  });
});

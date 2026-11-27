import { describe, expect, it } from "vitest";

import type { ClaimHolder } from "../src/claim-contract.js";
import { claimRefusalMessage } from "../src/claim-message.js";

const arin: ClaimHolder = {
  agentId: `agt_${"a".repeat(24)}`,
  displayName: "Arin",
  roleName: "Developer",
  origin: "team",
  workspaceId: `wsp_${"b".repeat(24)}`,
  conversationTitle: "Log format",
  kind: "changed",
  until: null,
};
const clockTime = () => "14:32";

describe("the refusal's message", () => {
  it("names a changed or sealed holder and its conversation after the guidance", () => {
    expect(
      claimRefusalMessage({ code: "path_changed_unsealed", paths: ["src/a.ts"], holder: arin }),
    ).toBe(
      'Lervo stopped this write. `src/a.ts` was changed by Arin (Developer), and that change is not sealed yet. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Mention @Arin with the change you need, continue with other paths, or try again after Arin\'s change is sealed. Arin works in the conversation "Log format".',
    );
    expect(
      claimRefusalMessage({
        code: "path_awaiting_integration",
        paths: ["src/a.ts", "src/b.ts"],
        holder: { ...arin, kind: "sealed_change" },
      }),
    ).toContain(
      "`src/a.ts` and `src/b.ts` are part of a sealed change by Arin (Developer) that has not integrated yet.",
    );
  });

  it("mentions nobody when the holder's origin is unknown", () => {
    const message = claimRefusalMessage({
      code: "path_leased",
      paths: ["src/a.ts"],
      holder: {
        ...arin,
        displayName: arin.agentId,
        roleName: "",
        origin: "unknown",
        kind: "lease",
      },
    });
    expect(message).toContain(
      "Continue with other paths, or try again after that change is sealed.",
    );
    expect(message).not.toContain("@");
  });

  it("keeps the guidance when long paths fill the message", () => {
    const message = claimRefusalMessage({
      code: "path_leased",
      paths: ["a".repeat(3000), "b".repeat(3000), "c".repeat(3000)],
      holder: { ...arin, conversationTitle: "t".repeat(80), kind: "lease" },
    });
    expect(message.length).toBeLessThanOrEqual(2048);
    expect(message).toContain("Do not write these paths another way. Mention @Arin");
  });

  it("never offers a mention of Lervo's own agents", () => {
    const message = claimRefusalMessage({
      code: "path_leased",
      paths: ["docs/a.md"],
      holder: { ...arin, origin: "lervo", conversationTitle: null, kind: "lease", until: "x" },
      clockTime,
    });
    expect(message).toBe(
      "Lervo stopped this write. `docs/a.md` is claimed by Lervo's knowledge maintenance until 14:32. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Continue with other paths, or try again after 14:32.",
    );
    expect(message).not.toContain("@");
  });

  it("says what to do for refusals without a holder, and stays within 2,048 characters", () => {
    expect(
      claimRefusalMessage({
        code: "outside_responsibility",
        paths: ["a", "b", "c", "d"],
        holder: null,
      }),
    ).toBe(
      "Lervo stopped this write. `a`, `b`, `c`, and 1 more path are outside your responsibility paths. Do not write these paths another way. Mention an agent whose responsibility covers them with the change you need, or continue with other paths.",
    );
    expect(
      claimRefusalMessage({ code: "lease_path_limit", paths: ["src/x.ts"], holder: null }),
    ).toContain("Seal the committed part of the change first");
    expect(
      claimRefusalMessage({
        code: "path_outside_workspace",
        paths: ["x".repeat(4000)],
        holder: null,
      }).length,
    ).toBeLessThan(500);
  });
});

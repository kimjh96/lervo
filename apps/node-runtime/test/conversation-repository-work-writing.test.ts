import { describe, expect, it } from "vitest";

import { executionInstructions, fitDiscord } from "../src/conversation-repository-work-writing.js";

describe("conversation repository work writing", () => {
  it("keeps post-exit replica finalization out of the provider's user-facing caveats", () => {
    const instructions = executionInstructions({
      request: "변경하고 검증해 주세요.",
      priorTurns: [],
      durableResults: [],
      worker: null,
      externalEffectsAuthorized: false,
      finalizationStartsAt: "2026-09-18T00:00:00.000Z",
    });
    expect(instructions).toContain(
      "Repository-replica freshness and the managed conversation-work completion event are host-owned post-exit gates",
    );
    expect(instructions).toContain(
      "Do not tell the user that final completion is withheld, pending, or unconfirmed",
    );
    expect(instructions).not.toContain(
      "checkpoint, valid current-scope knowledge, required verification, and replica parity",
    );
    expect(instructions).toContain("provider-native tools, plugins, and connectors as turn-local");
    expect(instructions).toContain(
      "both legacy discordConversation and plural discordConversations",
    );
    expect(instructions).toContain("attention_required proves missing verified receipt");
  });

  it("keeps the bounded result free of a fixed telemetry appendix", () => {
    expect(fitDiscord("완료했습니다.")).toBe("완료했습니다.");
  });

  it("keeps background knowledge work out of live provider instructions", () => {
    const input = {
      request: "README를 수정해 주세요.",
      priorTurns: [],
      durableResults: [],
      worker: null,
      externalEffectsAuthorized: false,
      finalizationStartsAt: "2026-09-18T00:00:00.000Z",
    };
    const background = executionInstructions({ ...input, knowledgeMode: "pending_background" });
    expect(background).toContain("The host owns background knowledge convergence");
    expect(background).toContain("do not claim repository knowledge is current");
    expect(background).not.toContain("valid current-scope knowledge");
    const synchronous = executionInstructions({ ...input, knowledgeMode: "synchronous" });
    expect(synchronous).toContain("valid current-scope knowledge");
  });

  it("permits an explicitly requested deployment only for an authorized requester", () => {
    const input = {
      request: "검증된 수정본을 배포해 주세요.",
      priorTurns: [],
      durableResults: [],
      worker: null,
      finalizationStartsAt: "2026-09-21T00:00:00.000Z",
    };
    const authorized = executionInstructions({ ...input, externalEffectsAuthorized: true });
    expect(authorized).toContain("deployment explicitly requested in Current request");
    expect(authorized).toContain("preserve a rollback");
    expect(authorized).toContain("Do not widen risk limits, reset a kill switch");
    expect(authorized).not.toContain("Deployment, broad deletion");

    const unauthorized = executionInstructions({ ...input, externalEffectsAuthorized: false });
    expect(unauthorized).toContain("Do not commit, push, publish, deploy");
  });
});

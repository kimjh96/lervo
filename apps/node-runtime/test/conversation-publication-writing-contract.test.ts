import {
  adaptiveConversationWritingContract,
  fixedConversationStatusWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";
import { describe, expect, it } from "vitest";

import { conversationPublicationWritingContract } from "../src/conversation-publication-writing-contract.js";

describe("conversation publication writing contract", () => {
  it.each(["read_only", "clarify"] as const)(
    "uses independent semantic review for the %s mode only when configured",
    (mode) => {
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: true }),
      ).toBe(adaptiveConversationWritingContract);
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: false }),
      ).toBe(realtimeConversationWritingContract);
    },
  );

  it.each(["work", "goal"] as const)(
    "keeps the %s responder and verifier on the realtime contract",
    (mode) => {
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: true }),
      ).toBe(realtimeConversationWritingContract);
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: false }),
      ).toBe(realtimeConversationWritingContract);
    },
  );

  it.each(["continuation", "platform_action", "control", null] as const)(
    "keeps the %s responder and verifier on the fixed-status contract",
    (mode) => {
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: true }),
      ).toBe(fixedConversationStatusWritingContract);
      expect(
        conversationPublicationWritingContract({ mode, independentReadEvaluation: false }),
      ).toBe(fixedConversationStatusWritingContract);
    },
  );
});

import type { ConversationResponder } from "@lervo/interaction";
import { describe, expect, it, vi } from "vitest";

import { ConversationEffectResultResponderBinding } from "../src/conversation-effect-result-responder.js";

describe("conversation effect result responder binding", () => {
  it("binds one managed responder before any completed effect is presented", async () => {
    const binding = new ConversationEffectResultResponderBinding();
    const request = {} as Parameters<ConversationResponder["respond"]>[0];
    const candidate = {} as Awaited<ReturnType<ConversationResponder["respond"]>>;

    await expect(binding.respond(request)).rejects.toThrow("is not bound");

    const respond = vi.fn(async () => candidate);
    binding.bind({ respond });

    await expect(binding.respond(request)).resolves.toBe(candidate);
    expect(respond).toHaveBeenCalledWith(request);
    expect(() => binding.bind({ respond })).toThrow("already bound");
  });
});

import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import { groupDiscordConversationRuntimes } from "../src/discord-conversation-group-runtime.js";
import type { NodeDiscordConversationRuntime } from "../src/discord-conversation-runtime.js";

function runtime(
  result: "ready" | "duplicate" | "ignored",
  close: () => void = () => undefined,
): NodeDiscordConversationRuntime {
  return {
    failed: new Promise(() => undefined),
    observeRemoteAcknowledgement: async () => result,
    runResultDeliveryCycle: async () => undefined,
    stopIngress: () => undefined,
    close,
  };
}

describe("Discord conversation runtime group", () => {
  it("aggregates acknowledgement ownership without inventing a second result", async () => {
    const group = groupDiscordConversationRuntimes([
      runtime("ignored"),
      runtime("ready"),
      runtime("duplicate"),
    ]);
    await expect(
      group.observeRemoteAcknowledgement({
        lease: {} as RemoteCommandLease,
        acknowledgement: {} as RemoteCommandDeliveryAcknowledgement,
      }),
    ).resolves.toBe("ready");
  });

  it("attempts every close and reports the collected failures", () => {
    const first = vi.fn(() => {
      throw new Error("first close failed");
    });
    const second = vi.fn(() => undefined);
    const group = groupDiscordConversationRuntimes([
      runtime("ignored", first),
      runtime("ignored", second),
    ]);
    expect(() => group.close()).toThrow(AggregateError);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});

import { expect, it, vi } from "vitest";

import {
  handleDiscordGoalCommand,
  registerDiscordGoalCommand,
} from "../src/discord-goal-command.js";

const command = {
  interactionId: "123456789012345678",
  applicationId: "999999999999999999",
  token: "interaction.token",
  guildId: "223456789012345678",
  channelId: "323456789012345678",
  userId: "423456789012345678",
  request: "Finish the goal.",
};
const receipt = { messageId: "523456789012345678", occurredAt: "2026-09-13T00:00:00.000Z" };

it("does not register /goal without a matching installed owner and guild scope", async () => {
  const fetch = vi.fn();
  const options = {
    config: {
      applicationId: command.applicationId,
      allowedGuildIds: [command.guildId],
      routing: {},
    },
    outcomeSupervision: { binding: { ownerAgentId: "agt_other" } },
    fetch,
  } as never;
  await expect(
    registerDiscordGoalCommand({
      options,
      agentParticipation: { agentId: "agt_owner" } as never,
      token: `discord.${"b".repeat(40)}`,
    }),
  ).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("acknowledges before intake and only reports a processed request after the processor returns", async () => {
  const order: string[] = [];
  const acknowledge = vi.fn(async () => {
    order.push("acknowledge");
    return receipt;
  });
  const receiveGoalResponseMessage = vi.fn(async () => {
    order.push("map");
    return { status: "accepted", checkpoint: null };
  });
  const process = vi.fn(async () => {
    order.push("process");
  });
  const update = vi.fn(async () => {
    order.push("update");
  });
  await handleDiscordGoalCommand({
    command,
    adapter: { receiveGoalResponseMessage } as never,
    process,
    commandRest: { acknowledge, update },
  });
  expect(order).toEqual(["acknowledge", "map", "process", "update"]);
  expect(receiveGoalResponseMessage).toHaveBeenCalledWith({ command, ...receipt });
  expect(process).toHaveBeenCalledOnce();
});

it("shows failure after a rejected intake without claiming success", async () => {
  const process = vi.fn();
  const update = vi.fn(async () => undefined);
  await expect(
    handleDiscordGoalCommand({
      command,
      adapter: {
        receiveGoalResponseMessage: async () => {
          throw new Error("authority expired");
        },
      } as never,
      process,
      commandRest: { acknowledge: async () => receipt, update },
    }),
  ).rejects.toThrow("authority expired");
  expect(process).not.toHaveBeenCalled();
  expect(update.mock.calls[0]![2]).toMatch(/접수하지 못했습니다/u);
});

it("keeps an admitted request uncertain when later processing fails", async () => {
  const update = vi.fn(async () => undefined);
  await expect(
    handleDiscordGoalCommand({
      command,
      adapter: {
        receiveGoalResponseMessage: async () => ({ status: "accepted", checkpoint: null }),
      } as never,
      process: async () => {
        throw new Error("delivery failed");
      },
      commandRest: { acknowledge: async () => receipt, update },
    }),
  ).rejects.toThrow("delivery failed");
  expect(update.mock.calls[0]![2]).toMatch(/처리 상태를 확인하지 못했습니다/u);
  expect(update.mock.calls[0]![2]).not.toMatch(/접수하지 못했습니다/u);
});

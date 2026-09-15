import { expect, it, vi } from "vitest";

import {
  handleDiscordGoalCommand,
  registerDiscordGoalCommand,
} from "../src/discord-goal-command.js";
import { DiscordGoalIntakeOutcomes } from "../src/discord-goal-intake-outcomes.js";

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
const event = { eventId: `evt_${"a".repeat(32)}` };

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

it.each([
  ["undeclared", {}],
  ["declined", { goalCommand: { announce: false } }],
] as const)(
  "does not register /goal for a matching owner whose announcement is %s",
  async (_label, declaration) => {
    const fetch = vi.fn();
    const options = {
      config: {
        applicationId: command.applicationId,
        allowedGuildIds: [command.guildId],
        routing: {},
      },
      outcomeSupervision: { binding: { ownerAgentId: "agt_owner" }, ...declaration },
      fetch,
    } as never;
    await expect(
      registerDiscordGoalCommand({
        options,
        agentParticipation: { agentId: "agt_owner" } as never,
        token: `discord.${"b".repeat(40)}`,
      }),
    ).resolves.toBeNull();
    // Guild commands are per application, so an undeclared deployment must advertise nothing rather
    // than race another installed owner for the same guild-wide `/goal`.
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("tells an out-of-scope channel how the same intake is reached", async () => {
  const update = vi.fn(
    async (_command: typeof command, _messageId: string, _content: string) => undefined,
  );
  const process = vi.fn();
  await handleDiscordGoalCommand({
    command,
    adapter: {
      receiveGoalResponseMessage: async () => ({
        status: "ignored",
        reason: "outside_conversation_scope",
        checkpoint: null,
      }),
    } as never,
    process,
    commandRest: { acknowledge: async () => receipt, update },
    outcomes: new DiscordGoalIntakeOutcomes(),
  });
  expect(process).not.toHaveBeenCalled();
  expect(update.mock.calls[0]![2]).toMatch(/담당자에게 직접 말씀하시면 같은 경로로 접수됩니다/u);
});

it("acknowledges before intake and only reports a processed request after the processor returns", async () => {
  const order: string[] = [];
  const acknowledge = vi.fn(async () => {
    order.push("acknowledge");
    return receipt;
  });
  const receiveGoalResponseMessage = vi.fn(async () => {
    order.push("map");
    return { status: "accepted", event, checkpoint: null };
  });
  const outcomes = new DiscordGoalIntakeOutcomes();
  const process = vi.fn(async () => {
    order.push("process");
    outcomes.record(event.eventId, { status: "bound" });
  });
  const update = vi.fn(async () => {
    order.push("update");
  });
  await handleDiscordGoalCommand({
    command,
    adapter: { receiveGoalResponseMessage } as never,
    process,
    commandRest: { acknowledge, update },
    outcomes,
  });
  expect(order).toEqual(["acknowledge", "map", "process", "update"]);
  expect(receiveGoalResponseMessage).toHaveBeenCalledWith({ command, ...receipt });
  expect(process).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith(
    command,
    receipt.messageId,
    expect.stringContaining("현재 진행 중인 목표에 요청을 연결했습니다"),
  );
  expect(outcomes.take(event.eventId)).toBeNull();
});

it("reports a refused binding as a refusal even though processing completed", async () => {
  const outcomes = new DiscordGoalIntakeOutcomes();
  const update = vi.fn(
    async (_command: typeof command, _messageId: string, _content: string) => undefined,
  );
  await handleDiscordGoalCommand({
    command,
    adapter: {
      receiveGoalResponseMessage: async () => ({ status: "accepted", event, checkpoint: null }),
    } as never,
    process: async () => {
      outcomes.record(event.eventId, { status: "refused", code: "origin_conflict" });
    },
    commandRest: { acknowledge: async () => receipt, update },
    outcomes,
  });
  expect(update).toHaveBeenCalledOnce();
  expect(update.mock.calls[0]![2]).toMatch(/이미 다른 요청이 연결되어 있어/u);
  expect(update.mock.calls[0]![2]).not.toMatch(/연결했습니다/u);
});

it("reports an unobserved intake outcome as uncertain rather than connected", async () => {
  const update = vi.fn(
    async (_command: typeof command, _messageId: string, _content: string) => undefined,
  );
  await handleDiscordGoalCommand({
    command,
    adapter: {
      receiveGoalResponseMessage: async () => ({ status: "accepted", event, checkpoint: null }),
    } as never,
    process: async () => undefined,
    commandRest: { acknowledge: async () => receipt, update },
    outcomes: new DiscordGoalIntakeOutcomes(),
  });
  expect(update.mock.calls[0]![2]).toMatch(/처리 상태를 확인하지 못했습니다/u);
  expect(update.mock.calls[0]![2]).not.toMatch(/연결했습니다/u);
});

it("shows failure after a rejected intake without claiming success", async () => {
  const process = vi.fn();
  const update = vi.fn(
    async (_command: typeof command, _messageId: string, _content: string) => undefined,
  );
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
      outcomes: new DiscordGoalIntakeOutcomes(),
    }),
  ).rejects.toThrow("authority expired");
  expect(process).not.toHaveBeenCalled();
  expect(update.mock.calls[0]![2]).toMatch(/접수하지 못했습니다/u);
});

it("keeps an admitted request uncertain when later processing fails", async () => {
  const update = vi.fn(
    async (_command: typeof command, _messageId: string, _content: string) => undefined,
  );
  await expect(
    handleDiscordGoalCommand({
      command,
      adapter: {
        receiveGoalResponseMessage: async () => ({ status: "accepted", event, checkpoint: null }),
      } as never,
      process: async () => {
        throw new Error("delivery failed");
      },
      commandRest: { acknowledge: async () => receipt, update },
      outcomes: new DiscordGoalIntakeOutcomes(),
    }),
  ).rejects.toThrow("delivery failed");
  expect(update.mock.calls[0]![2]).toMatch(/처리 상태를 확인하지 못했습니다/u);
  expect(update.mock.calls[0]![2]).not.toMatch(/접수하지 못했습니다/u);
});

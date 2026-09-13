import { expect, it, vi } from "vitest";

import { parseDiscordGatewayPayload } from "../src/payload.js";
import { DiscordRestGoalCommand } from "../src/rest-goal-command.js";

const command = {
  interactionId: "123456789012345678",
  applicationId: "999999999999999999",
  token: `interaction.${"t".repeat(40)}`,
  guildId: "223456789012345678",
  channelId: "323456789012345678",
  userId: "423456789012345678",
  request: "Finish and verify the delivery.",
};

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rest(fetch: typeof globalThis.fetch) {
  return new DiscordRestGoalCommand({
    applicationId: command.applicationId,
    botToken: `discord.${"b".repeat(40)}`,
    allowedGuildIds: [command.guildId],
    apiBaseUrl: "http://discord.test/api/v10",
    allowInsecureHttpForTests: true,
    fetch,
  });
}

const message = {
  id: "523456789012345678",
  channel_id: command.channelId,
  timestamp: "2026-09-13T00:00:00.000Z",
};

it("parses an authenticated human guild /goal with one bounded request", () => {
  const parsed = parseDiscordGatewayPayload({
    op: 0,
    s: 7,
    t: "INTERACTION_CREATE",
    d: {
      type: 2,
      id: command.interactionId,
      application_id: command.applicationId,
      token: command.token,
      guild_id: command.guildId,
      channel_id: command.channelId,
      member: { user: { id: command.userId, bot: false } },
      data: {
        name: "goal",
        type: 1,
        options: [{ name: "request", type: 3, value: command.request }],
      },
    },
  });
  expect(parsed).toMatchObject({ kind: "goal_command", command });
});

it("rejects malformed or bot-owned /goal input", () => {
  const payload = {
    op: 0,
    s: 7,
    t: "INTERACTION_CREATE",
    d: {
      type: 2,
      id: command.interactionId,
      application_id: command.applicationId,
      token: command.token,
      guild_id: command.guildId,
      channel_id: command.channelId,
      member: { user: { id: command.userId, bot: true } },
      data: {
        name: "goal",
        type: 1,
        options: [{ name: "request", type: 3, value: command.request }],
      },
    },
  };
  expect(() => parseDiscordGatewayPayload(payload)).toThrow(/bot cannot invoke/iu);
  payload.d.member.user.bot = false;
  payload.d.data.options[0]!.value = "  ";
  expect(() => parseDiscordGatewayPayload(payload)).toThrow(/request is invalid/iu);
});

it("registers the reviewed guild command once and verifies its exact scope", async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    init?.method === "GET"
      ? response([])
      : response({ name: "goal", type: 1, guild_id: command.guildId }),
  );
  await rest(fetch as typeof globalThis.fetch).register();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({
    name: "goal",
    options: [{ name: "request", required: true, max_length: 4_000 }],
  });
});

it("preserves a conflicting existing guild command instead of replacing it", async () => {
  const fetch = vi.fn(async () =>
    response([{ name: "goal", type: 1, description: "Other owner" }]),
  );
  await expect(rest(fetch as typeof globalThis.fetch).register()).rejects.toMatchObject({
    code: "invalid_platform_configuration",
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it("acknowledges once, binds the public response ID and edits without mentions", async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST"
      ? response({
          interaction: { id: command.interactionId, response_message_id: message.id },
          resource: { message },
        })
      : response(message),
  );
  const goal = rest(fetch as typeof globalThis.fetch);
  await expect(goal.acknowledge(command)).resolves.toEqual({
    messageId: message.id,
    occurredAt: message.timestamp,
  });
  await goal.update(command, message.id, "Accepted.");
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
    type: 4,
    data: { allowed_mentions: { parse: [] } },
  });
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({
    allowed_mentions: { parse: [] },
  });
});

it("recovers an uncertain acknowledgement with GET and never repeats POST", async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error("response lost");
    return response(message);
  });
  await expect(rest(fetch as typeof globalThis.fetch).acknowledge(command)).resolves.toMatchObject({
    messageId: message.id,
  });
  expect(fetch.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "GET"]);
});

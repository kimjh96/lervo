import { expect, it } from "vitest";
import { parseDiscordMessagePayload } from "../src/payload.js";
import { createDiscordMessageNonce } from "../src/message-nonce.js";

function payload(content: string, mentions: { id: string }[] = []) {
  return {
    id: "123456789012345678",
    channel_id: "223456789012345678",
    guild_id: "323456789012345678",
    author: { id: "423456789012345678", bot: true },
    content,
    mentions,
    timestamp: "2026-09-13T05:49:38.245Z",
  };
}

it.each(["<@523456789012345678> inspect", "  <@!523456789012345678> inspect"])(
  "preserves an explicit leading address when Discord suppresses mention metadata: %s",
  (content) => {
    const parsed = parseDiscordMessagePayload(payload(content));
    expect(parsed.mentionedParticipantKeys).toEqual(["user:523456789012345678"]);
    expect(parsed.actorKindHint).toBe("agent");
    expect(parsed.content).toBe(content);
  },
);

it.each([
  "Inspect the reference <@523456789012345678>",
  "`<@523456789012345678>` inspect",
  "> <@523456789012345678> inspect",
  "\\<@523456789012345678> inspect",
  "<@&523456789012345678> inspect",
  "<@523456789012345678>suffix",
  `<@${"5".repeat(33)}> inspect`,
])("does not invent an address from unmarked or quoted message text: %s", (content) => {
  expect(parseDiscordMessagePayload(payload(content)).mentionedParticipantKeys).toEqual([]);
});

it("deduplicates the leading address while retaining authenticated mention metadata", () => {
  const parsed = parseDiscordMessagePayload(
    payload("<@523456789012345678> inspect", [
      { id: "523456789012345678" },
      { id: "623456789012345678" },
    ]),
  );
  expect(parsed.mentionedParticipantKeys).toEqual([
    "user:523456789012345678",
    "user:623456789012345678",
  ]);
});

it.each([{ bot: true }, { bot: false, webhook_id: "723456789012345678" }])(
  "does not turn an agent acknowledgement reply into a new address: %j",
  (sender) => {
    const parsed = parseDiscordMessagePayload({
      ...payload("Acknowledged."),
      author: { id: "423456789012345678", bot: sender.bot },
      webhook_id: sender.webhook_id,
      message_reference: { message_id: "823456789012345678" },
      referenced_message: { author: { id: "523456789012345678", bot: true } },
    });
    expect(parsed.mentionedParticipantKeys).toEqual([]);
    expect(parsed.replyToMessageId).toBe("823456789012345678");
  },
);

it("preserves human reply addressing and explicitly addressed agent replies", () => {
  const reference = {
    referenced_message: { author: { id: "523456789012345678", bot: true } },
  };
  expect(
    parseDiscordMessagePayload({
      ...payload("Continue."),
      ...reference,
      author: { id: "423456789012345678", bot: false },
    }).mentionedParticipantKeys,
  ).toEqual(["bot:523456789012345678"]);
  expect(
    parseDiscordMessagePayload({
      ...payload("<@523456789012345678> Continue."),
      ...reference,
    }).mentionedParticipantKeys,
  ).toEqual(["user:523456789012345678"]);
});

it("restores observation-only Lervo publication lineage without inspecting message text", () => {
  const parsed = parseDiscordMessagePayload({
    ...payload("사용자에게 보이는 정상 상태 문장입니다."),
    nonce: createDiscordMessageNonce("cvo_status0001", "observe_only"),
  });
  expect(parsed.audienceParticipation).toBe("observe_only");
});

it("does not let human or unclassified messages suppress agent participation", () => {
  const marker = createDiscordMessageNonce("cvo_status0002", "observe_only");
  expect(
    parseDiscordMessagePayload({
      ...payload("same visible text"),
      author: { id: "423456789012345678", bot: false },
      nonce: marker,
    }).audienceParticipation,
  ).toBe("eligible");
  expect(
    parseDiscordMessagePayload({ ...payload("same visible text"), nonce: "foreign" }),
  ).toMatchObject({ audienceParticipation: "eligible" });
});

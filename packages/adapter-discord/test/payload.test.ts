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
    expect(parsed.mentionedParticipantKeys).toEqual([
      "user:523456789012345678",
      "bot:523456789012345678",
    ]);
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

it("retains a Discord managed-role address separately from user and bot mentions", () => {
  const roleId = "523456789012345678";
  const parsed = parseDiscordMessagePayload({
    ...payload(`<@&${roleId}> inspect`),
    mention_roles: [roleId],
  });
  expect(parsed.mentionedRoleIds).toEqual([roleId]);
  expect(parsed.mentionedParticipantKeys).toEqual([]);
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
    "bot:523456789012345678",
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
  ).toEqual(["user:523456789012345678", "bot:523456789012345678"]);
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

it("restores authenticated discussion assignments and every marked bot target", () => {
  const coordination = {
    kind: "discussion.assignment" as const,
    discussionId: "dsc_abcdefghijklmnopqrst",
    assignmentSequence: 1 as const,
  };
  const parsed = parseDiscordMessagePayload({
    ...payload("<@523456789012345678> <@623456789012345678> 각자의 실제 역할로 검토해주세요."),
    nonce: createDiscordMessageNonce("cvo_assignment01", "eligible", coordination),
  });
  expect(parsed.coordination).toEqual(coordination);
  expect(parsed.mentionedParticipantKeys).toEqual([
    "user:523456789012345678",
    "bot:523456789012345678",
    "user:623456789012345678",
    "bot:623456789012345678",
  ]);
  expect(parsed.coordinationTargetParticipantKeys).toEqual([
    "user:523456789012345678",
    "bot:523456789012345678",
  ]);
  expect(parsed.audienceParticipation).toBe("eligible");

  const nextCoordination = { ...coordination, assignmentSequence: 2 as const };
  const nextNonce = createDiscordMessageNonce("cvo_assignment02", "eligible", nextCoordination);
  expect(nextNonce).not.toBe(
    createDiscordMessageNonce("cvo_assignment01", "eligible", coordination),
  );
  expect(
    parseDiscordMessagePayload({
      ...payload("<@623456789012345678> <@523456789012345678> 다음 검토입니다."),
      nonce: nextNonce,
    }).coordination,
  ).toEqual(nextCoordination);
});

it("routes only a marked agent contribution back to the referenced coordinator", () => {
  const coordination = {
    kind: "discussion.contribution" as const,
    discussionId: "dsc_abcdefghijklmnopqrst",
  };
  const parsed = parseDiscordMessagePayload({
    ...payload("제 역할의 맥락에서는 이 결론에 반대합니다."),
    nonce: createDiscordMessageNonce("cvo_contribution01", "eligible", coordination),
    message_reference: { message_id: "823456789012345678" },
    referenced_message: { author: { id: "523456789012345678", bot: true } },
  });
  expect(parsed.coordination).toEqual(coordination);
  expect(parsed.mentionedParticipantKeys).toEqual(["bot:523456789012345678"]);
});

it("routes a marked delegated-task result back to its referenced coordinator", () => {
  const taskId = `tsk_${"q".repeat(20)}`;
  const assignment = parseDiscordMessagePayload({
    ...payload("<@523456789012345678> 원 요청 전체를 수행해 주세요."),
    nonce: createDiscordMessageNonce("cvo_taskassignment01", "eligible", {
      kind: "task.assignment",
      taskId,
    }),
  });
  expect(assignment.coordination).toEqual({ kind: "task.assignment", taskId });
  expect(assignment.coordinationTargetParticipantKeys).toEqual([
    "user:523456789012345678",
    "bot:523456789012345678",
  ]);

  const result = parseDiscordMessagePayload({
    ...payload("요청된 확인과 후속 조치를 완료했습니다."),
    nonce: createDiscordMessageNonce("cvo_taskresult00001", "eligible", {
      kind: "task.result",
      taskId,
    }),
    message_reference: { message_id: "823456789012345678" },
    referenced_message: { author: { id: "523456789012345678", bot: true } },
  });
  expect(result.coordination).toEqual({ kind: "task.result", taskId });
  expect(result.mentionedParticipantKeys).toEqual(["bot:523456789012345678"]);
  expect(result.coordinationTargetParticipantKeys).toEqual(["bot:523456789012345678"]);
});

it("makes a marked final discussion decision observation-only", () => {
  const coordination = {
    kind: "discussion.decision" as const,
    discussionId: "dsc_abcdefghijklmnopqrst",
  };
  const parsed = parseDiscordMessagePayload({
    ...payload("최종 결론입니다."),
    nonce: createDiscordMessageNonce("cvo_decision01", "eligible", coordination),
  });
  expect(parsed.coordination).toEqual(coordination);
  expect(parsed.audienceParticipation).toBe("observe_only");
});

import { expect, it } from "vitest";

import {
  DiscordGoalIntakeOutcomes,
  discordGoalIntakeStatusMessage,
} from "../src/discord-goal-intake-outcomes.js";

it("hands each recorded outcome to exactly one reader and bounds retention", () => {
  const outcomes = new DiscordGoalIntakeOutcomes();
  outcomes.record("evt_first", { status: "refused", code: "owner_busy" });
  expect(outcomes.take("evt_first")).toEqual({ status: "refused", code: "owner_busy" });
  expect(outcomes.take("evt_first")).toBeNull();
  for (let index = 0; index < 300; index += 1) outcomes.record(`evt_${index}`, { status: "bound" });
  expect(outcomes.take("evt_0")).toBeNull();
  expect(outcomes.take("evt_299")).toEqual({ status: "bound" });
});

it("never words a missing or uncertain outcome as a connected request", () => {
  expect(discordGoalIntakeStatusMessage({ status: "bound" })).toMatch(/연결했습니다/u);
  expect(discordGoalIntakeStatusMessage({ status: "duplicate" })).toMatch(/이미 현재 목표에/u);
  expect(discordGoalIntakeStatusMessage({ status: "refused", code: "origin_conflict" })).toMatch(
    /별도 목표로 접수/u,
  );
  expect(discordGoalIntakeStatusMessage({ status: "refused", code: "owner_busy" })).toMatch(
    /기록되지 않았으니/u,
  );
  expect(discordGoalIntakeStatusMessage({ status: "refused", code: "evidence_changed" })).toMatch(
    /evidence_changed/u,
  );
  for (const outcome of [null, { status: "uncertain" } as const]) {
    expect(discordGoalIntakeStatusMessage(outcome)).toMatch(/확인하지 못했습니다/u);
    expect(discordGoalIntakeStatusMessage(outcome)).not.toMatch(/연결했습니다/u);
  }
});

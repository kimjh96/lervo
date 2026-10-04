import assert from "node:assert/strict";
import { test } from "vitest";

import { configuredDiscordDeployment } from "../lib/discord-delivery-reconciliation.mjs";

const legacy = { integrationId: "itg_legacy01" };
const first = { integrationId: "itg_plural01" };
const second = { integrationId: "itg_plural02" };

test("finds Discord deployments through both supported configuration shapes", () => {
  assert.equal(
    configuredDiscordDeployment({ discordConversation: legacy }, legacy.integrationId),
    legacy,
  );
  assert.equal(
    configuredDiscordDeployment({ discordConversations: [first, second] }, second.integrationId),
    second,
  );
  assert.equal(
    configuredDiscordDeployment({ discordConversations: [first] }, "itg_absent01"),
    undefined,
  );
});

test("rejects an ambiguous mixed legacy and plural configuration", () => {
  assert.throws(
    () =>
      configuredDiscordDeployment(
        { discordConversation: legacy, discordConversations: [first] },
        legacy.integrationId,
      ),
    /either discordConversation or discordConversations/u,
  );
});

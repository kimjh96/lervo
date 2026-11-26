import { describe, expect, it } from "vitest";

import { mentionedAgents } from "../src/room-mentions.js";

const team = [
  { agentId: "agt_elio", displayName: "Elio" },
  { agentId: "agt_arin", displayName: "Arin" },
  { agentId: "agt_writer", displayName: "Arin-92AE" },
  { agentId: "agt_ciel", displayName: "Ciel" },
];

describe("mentions in a conversation's turns", () => {
  it("names the mentioned agents in the order the text first mentions them", () => {
    expect(mentionedAgents("@Ciel please ask @arin, then @Ciel again.", team)).toEqual([
      "agt_ciel",
      "agt_arin",
    ]);
  });

  it("lets a longer name win over a shorter one it begins with", () => {
    expect(mentionedAgents("@Arin-92AE drafts it; @Arin checks it.", team)).toEqual([
      "agt_writer",
      "agt_arin",
    ]);
  });

  it("ignores names inside words, e-mail addresses, code, and unknown names", () => {
    const text = [
      "mail me at ops@Elio.dev or write @Elion",
      "`@Ciel` stays code",
      "```",
      "@Arin in a block",
      "```",
      "@Tarin is not on the team",
    ].join("\n");
    expect(mentionedAgents(text, team)).toEqual([]);
  });
});

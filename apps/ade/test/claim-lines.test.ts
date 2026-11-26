import type { ConversationItem } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { ConversationItemView } from "../src/features/conversation/view/renderers";
import { messagesFor } from "../src/i18n/catalog";

const line = (code: string, parameters: Record<string, string>): ConversationItem => ({
  kind: "lervo_notice",
  itemId: "n1",
  createdAtMs: 1,
  state: "complete",
  code,
  parameters,
});
const render = (item: ConversationItem) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(ConversationItemView, { item }),
    ),
  );
const conflict = {
  agent: "Ciel",
  path: "src/retry.ts",
  code: "path_leased",
  holder: "Arin",
  workspace: "wsp_a",
};

describe("the claim lines", () => {
  it("names the holder alone when its conversation is not listed, and the code when no one holds it", () => {
    expect(render(line("claim_conflict", conflict))).toContain(
      ">src/retry.ts</code> · Arin holds it</p>",
    );
    expect(
      render(line("claim_conflict", { ...conflict, holder: "", code: "outside_responsibility" })),
    ).toContain(">src/retry.ts</code> (outside_responsibility)</p>");
  });

  it("says once a turn that its claims wait for its end", () => {
    expect(render(line("claim_deferred", { code: "workforce_busy" }))).toContain(
      "Lervo checks this turn&#x27;s claims at its end (workforce_busy)",
    );
  });
});

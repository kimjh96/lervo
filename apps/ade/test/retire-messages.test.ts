import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedMessage, IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { messagesFor } from "../src/i18n/catalog";

const say = (id: string) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(FormattedMessage, { id }),
    ),
  );

describe("what removing a workspace says when the core refuses", () => {
  it("says what to do when a change waits for integration or the checkout moved", () => {
    expect(say("workspace.retire.failed.workspace_integration_pending")).toBe(
      "A change from this workspace is waiting to be integrated. Remove it after it integrates.",
    );
    expect(say("workspace.retire.failed.workspace_worktree_unresolved")).toBe(
      "This workspace&#x27;s folder was moved or switched to another branch. Remove that folder, then try again.",
    );
  });
});

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
  it("offers removing with changes, and says when their copy could not be kept", () => {
    expect(say("workspace.retire.failed.workspace_has_changes")).toBe(
      "This workspace has uncommitted changes.",
    );
    expect(say("workspace.retire.withChanges")).toBe("Remove with changes");
    expect(say("workspace.retire.questionWithChanges")).toBe(
      "Remove it with its changes? Lervo keeps them, not ignored files, for up to 14 days.",
    );
    expect(say("workspace.retire.failed.workspace_nested_repository")).toBe(
      "A nested repository or submodule here has work Lervo cannot keep. Commit and push it, or remove it, first.",
    );
    expect(say("start.keptChanges")).toContain("Lervo keeps them for up to 14 days");
    expect(say("workspace.retire.failed.workspace_changes_not_kept")).toBe(
      "Lervo could not keep a copy of the changes, so it removed nothing.",
    );
  });

  it("says what to do when a change waits for integration or the checkout moved", () => {
    expect(say("workspace.retire.failed.workspace_integration_pending")).toBe(
      "A change from this workspace is waiting to be integrated. Remove it after it integrates.",
    );
    expect(say("workspace.retire.failed.workspace_worktree_unresolved")).toBe(
      "This workspace&#x27;s folder was moved or switched to another branch. Remove that folder, then try again.",
    );
  });
});

import { type ConversationItem, lervoCommandIds } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { ToolLine } from "../src/features/conversation/view/ToolLine";
import {
  createToolLinesStore,
  ToolLinesProvider,
} from "../src/features/conversation/view/ToolLinesProvider";
import { messagesFor } from "../src/i18n/catalog";

type ToolItem = Extract<ConversationItem, { kind: "tool_activity" }>;

/** The line in a conversation whose `opened` lines are open, as the server renders it. */
const render = (item: ToolItem, opened: readonly string[] = []) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(
        ToolLinesProvider,
        { conversation: {}, opened },
        createElement(ToolLine, { item }),
      ),
    ),
  );

const tool = (fields: Partial<ToolItem["tool"]>, itemId = "i1"): ToolItem => ({
  kind: "tool_activity",
  itemId,
  createdAtMs: 1,
  state: "complete",
  tool: { name: "Edit", status: "succeeded", calls: 1, ...fields },
});

const edit = tool({
  detail: {
    subject: { kind: "path", text: "src/login.ts" },
    counts: { added: 2, removed: 1 },
    preview: {
      format: "diff",
      lines: ["@@ -3,1 +3,2 @@", "-export const maximum = 64;", "+export const maximum = 1024;"],
      omittedLines: 5,
      omittedAt: 3,
    },
  },
});

describe("tool lines", () => {
  it("shows the tool, what it acted on, and its result, closed until the user opens it", () => {
    const closed = render(edit);
    expect(closed).toContain("Edit");
    expect(closed).toContain("src/login.ts");
    expect(closed).toContain("+2");
    expect(closed).toContain("−1");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("maximum = 1024");

    const opened = render(edit, ["i1"]);
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toMatch(/data-change="removed"[^>]*>-export const maximum = 64;/u);
    expect(opened).toMatch(/data-change="added"[^>]*>\+export const maximum = 1024;/u);
    expect(opened).toContain("5 more lines");
  });

  it("opens and closes each line on its own", () => {
    const store = createToolLinesStore();
    store.getState().toggle("i1");
    store.getState().toggle("i2");
    store.getState().toggle("i1");
    expect([...store.getState().opened]).toEqual(["i2"]);
  });

  it("shows a count without a preview as a plain line, and a failure as failed", () => {
    const read = render(
      tool({
        name: "Read",
        detail: { subject: { kind: "path", text: "src/login.ts" }, counts: { lines: 42 } },
      }),
    );
    expect(read).toContain("42 lines");
    expect(read).not.toContain("<button");
    const failed = render(
      tool({
        name: "Bash",
        status: "failed",
        detail: {
          subject: { kind: "command", text: "pnpm test" },
          preview: { format: "output", lines: ["Exit code 1"], omittedLines: 0, omittedAt: 1 },
        },
      }),
    );
    expect(failed).toContain("failed");
    expect(failed).toContain("pnpm test");
  });

  it("shows a Lervo command as what Lervo did, opening to the exact command", () => {
    const call = (text: string, lervo: object, status: "succeeded" | "failed" = "succeeded") =>
      tool({
        name: "Bash",
        status,
        detail: { subject: { kind: "command", text }, lervo } as ToolItem["tool"]["detail"],
      });
    const search = call('lervo knowledge query "password limit login"', {
      command: "knowledge query",
      subject: "password limit login",
    });
    expect(render(search)).toContain("Searched for “password limit login”");
    expect(render(search)).not.toContain("Bash");
    const update = call("lervo workstream update --apply-now", { command: "workstream update" });
    expect(render(update)).toContain("Updated the workstream");
    expect(render(update)).toContain('aria-expanded="false"');
    expect(render(update, ["i1"])).toContain("lervo workstream update --apply-now");
    expect(
      render(call("lervo workstream update", { command: "workstream update" }, "failed")),
    ).toMatch(/lervo workstream update<\/span> failed/u);
    expect(
      render(
        call("lervo workstream update --help", { command: "workstream update", flag: "help" }),
      ),
    ).toMatch(/Looked up the help for <span[^>]*>lervo workstream update/u);
    expect(render(call("lervo --version", { command: "", flag: "version" }))).toContain(
      "Checked Lervo&#x27;s version",
    );
    expect(render(call("lervo garden prune", { command: "garden" }))).toMatch(
      /Ran <span[^>]*>lervo garden/u,
    );
  });

  it("has a sentence for every Lervo command", () => {
    const missing: string[] = [];
    for (const command of lervoCommandIds) {
      const html = renderToStaticMarkup(
        createElement(
          IntlProvider,
          {
            locale: "en",
            messages: messagesFor("en"),
            onError: () => missing.push(command),
          },
          createElement(
            ToolLinesProvider,
            { conversation: {} },
            createElement(ToolLine, {
              item: tool({
                name: "Bash",
                detail: {
                  subject: { kind: "command", text: `lervo ${command}` },
                  lervo: { command },
                },
              }),
            }),
          ),
        ),
      );
      expect(html, command).not.toContain("lervo.command.");
    }
    expect(missing).toEqual([]);
  });

  it("shows a line stored before details existed by its tool and status", () => {
    expect(render(tool({ name: "Read", calls: 3 }))).toContain("Read · 3 calls");
    expect(render(tool({ name: "Bash", status: "failed" }))).toContain("Bash failed");
  });
});

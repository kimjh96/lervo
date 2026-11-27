import type { TurnSummary } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";

import { createTurnSummariesStore } from "../src/features/conversation/model/turn-summaries";
import { TurnSummariesProvider } from "../src/features/conversation/view/TurnSummariesProvider";
import { RequestFailure } from "../src/ports";
import { TurnSummaryLine } from "../src/features/conversation/view/TurnSummaryLine";
import { messagesFor } from "../src/i18n/catalog";

const summary: TurnSummary = {
  given: { documents: 1, workstreamRevision: 5 },
  searched: { documents: 2, paths: ["docs/a.md", "docs/b.md"] },
  cited: 1,
  outcome: {
    repositoryChanged: true,
    changedPaths: 3,
    workstreamRevision: 6,
    completion: "allowed",
  },
  usage: { inputTokens: 518808, cachedInputTokens: 481145, outputTokens: 6846, costUsd: 0.97 },
};

const render = (value: TurnSummary | null, opened: string[] = [], elapsedMs?: number) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(
        TurnSummariesProvider,
        { conversation: {}, summarize: async () => value, ready: { t1: value }, opened },
        createElement(TurnSummaryLine, { turn: "t1", window: { startedAtMs: 1 }, elapsedMs }),
      ),
    ),
  );

describe("the Lervo turn summary", () => {
  it("shows what the turn did beyond the usual on one line, closed", () => {
    const closed = render(summary);
    for (const fact of [
      "2 documents found",
      "1 document given",
      "1 cited",
      "3 files changed",
      "Workstream updated",
    ])
      expect(closed).toContain(fact);
    expect(closed).toContain('aria-expanded="false"');
    // Usage waits in the card.
    expect(closed).not.toContain("list price");
  });

  it("opens to the card of what was given, used, changed, and spent", () => {
    const opened = render(summary, ["t1"]);
    for (const text of [
      "Given to the agent",
      "Revision 5",
      "Found by search",
      "docs/b.md",
      "Updated to revision 6",
      "518.8K input (481.1K cached) · 6.8K output · ≈ $0.97 (list price)",
    ])
      expect(opened).toContain(text);
  });

  it("reads an ordinary turn as its time alone, and shows nothing for a turn the core did not record", () => {
    const ordinary: TurnSummary = {
      given: { documents: 0 },
      searched: { documents: 0, paths: [] },
      cited: 0,
      outcome: { repositoryChanged: false, completion: "allowed" },
    };
    expect(render(ordinary, [], 12_400)).toContain(">12s<");
    expect(render(ordinary, [], 185_000)).toContain(">3m 5s<");
    expect(render(summary, [], 48_000)).toMatch(/>48s<.*2 documents found/u);
    // Without a time, the line still opens to the card, which shows only what it has.
    expect(render(ordinary)).toContain("Details");
    const card = render(ordinary, ["t1"]);
    expect(card).not.toContain("Used by the agent");
    expect(card).not.toContain("Outcome");
    expect(card).not.toContain("None");
    expect(render(null)).not.toContain("<button");
  });

  it("asks the core once per turn", async () => {
    const summarize = vi.fn<() => Promise<TurnSummary | null>>().mockResolvedValue(summary);
    const store = createTurnSummariesStore(summarize);
    store.getState().load("t1", { startedAtMs: 1 });
    store.getState().load("t1", { startedAtMs: 1 });
    await vi.waitFor(() =>
      expect(store.getState().entries.t1).toEqual({ state: "ready", summary }),
    );
    store.getState().load("t1", { startedAtMs: 1 });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure's code and asks again only when the conversation reopens", async () => {
    const summarize = vi
      .fn<() => Promise<TurnSummary | null>>()
      .mockRejectedValueOnce(new RequestFailure("application_unavailable"));
    summarize.mockResolvedValue(summary);
    const store = createTurnSummariesStore(summarize);
    store.getState().load("t1", { startedAtMs: 1 });
    await vi.waitFor(() =>
      expect(store.getState().entries.t1).toEqual({
        state: "failed",
        code: "application_unavailable",
      }),
    );
    // A line that renders again does not ask a failing core again.
    store.getState().load("t1", { startedAtMs: 1 });
    expect(summarize).toHaveBeenCalledTimes(1);
    // A reopened conversation has a new store, which asks again.
    const reopened = createTurnSummariesStore(summarize);
    reopened.getState().load("t1", { startedAtMs: 1 });
    await vi.waitFor(() =>
      expect(reopened.getState().entries.t1).toEqual({ state: "ready", summary }),
    );
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it("counts the rules Lervo gave, and says of how many when some did not fit", () => {
    const withRules = (prepared: number, omitted: number) =>
      render({ ...summary, given: { ...summary.given, ownerRules: { prepared, omitted } } }, [
        "t1",
      ]);
    expect(withRules(2, 0)).toContain(">Rules<");
    expect(withRules(2, 0)).toMatch(/>Rules<\/dt><dd[^>]*>2<\/dd>/u);
    expect(withRules(2, 12)).toContain("2 of 14");
    expect(withRules(0, 0)).not.toContain(">Rules<");
    expect(render(summary, ["t1"])).not.toContain(">Rules<");
    // Prepared, never applied: Lervo cannot observe the agent's use of a rule.
    expect(withRules(2, 12)).not.toMatch(/applied/iu);
  });
});

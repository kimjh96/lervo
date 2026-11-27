import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it } from "vitest";

import { loadLearned } from "../src/features/agents/model/learned";
import { useAgentStore } from "../src/features/agents/model/store";
import { HeldSection } from "../src/features/agents/view/HeldSection";
import { messagesFor } from "../src/i18n/catalog";
import type { ApplicationCommands } from "../src/ports";

const answer = (extra: object) =>
  ({
    async run() {
      return { projectId: "prj_1", agentId: "agt_elio", entries: [], ...extra };
    },
  }) as unknown as ApplicationCommands;

const rendered = () =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(HeldSection, { agentId: "agt_elio" }),
    ),
  );

afterEach(() => useAgentStore.setState({ learned: null }));

describe("the paths an agent holds, in its profile", () => {
  it("keeps the core's held paths and says how many more it holds", async () => {
    await loadLearned(answer({ paths: ["docs", "src/net"], pathsTotal: 5 }), "prj_1", "agt_elio");
    expect(useAgentStore.getState().learned?.held).toEqual({
      paths: ["docs", "src/net"],
      total: 5,
    });
  });

  it("holds nothing from a core that does not read leases, and shows no section", async () => {
    await loadLearned(answer({}), "prj_1", "agt_elio");
    expect(useAgentStore.getState().learned?.held).toBeNull();
    expect(rendered()).toBe("");
  });
});

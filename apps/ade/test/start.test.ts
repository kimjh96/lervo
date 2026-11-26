import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { beforeEach, describe, expect, it } from "vitest";

import { StartNotice } from "../src/features/conversation/view/StartNotice";

import { startWork } from "../src/features/start/model/start";
import { useStartStore } from "../src/features/start/model/store";
import { useWorkspaceStore } from "../src/features/workspaces";
import { messagesFor } from "../src/i18n/catalog";
import { type ApplicationCommands, RequestFailure } from "../src/ports";

/** Commands whose `workspace.start` waits until `finish` resolves or rejects it. */
function commands() {
  let finish:
    | { resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void }
    | undefined;
  const fake = {
    run(command: string) {
      if (command === "workspace.start")
        return new Promise((resolve, reject) => (finish = { resolve, reject }));
      if (command === "workspace.list") return Promise.resolve({ workspaces: [] });
      return Promise.resolve({ repositories: [] });
    },
  } as unknown as ApplicationCommands;
  return { fake, finish: () => finish };
}

const draft = { instruction: "  Fix the build  ", repository: "prj_1", provider: "claude" };

beforeEach(() => {
  useStartStore.setState({
    draft: { instruction: "", repository: "", provider: "claude" },
    pending: null,
    error: null,
  });
  useWorkspaceStore.setState({ selected: null });
});

describe("starting work", () => {
  it("shows the pending workspace at once and selects the created one", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    expect(useStartStore.getState().pending).toMatchObject({
      instruction: "Fix the build",
      repositoryName: "web",
      workspaceId: null,
    });
    expect(useStartStore.getState().draft.instruction).toBe("");
    host.finish()?.resolve({ workspaceId: "wks_1" });
    await started;
    expect(useStartStore.getState().pending?.workspaceId).toBe("wks_1");
    expect(useWorkspaceStore.getState().selected).toBe("wks_1");
  });

  it("keeps the core's notice when the work started without something", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    host.finish()?.resolve({
      workspaceId: "wks_1",
      base: {
        source: "local",
        upstream: "origin/main",
        notice: "fetch_failed",
        replayed: 0,
        skipped: 0,
        carried: 0,
      },
    });
    await started;
    expect(useStartStore.getState().pending?.baseNotice).toEqual({
      code: "fetch_failed",
      upstream: "origin/main",
    });
  });

  it("has no notice when the work started as it should, or from an older core", async () => {
    for (const result of [
      { workspaceId: "wks_1" },
      {
        workspaceId: "wks_1",
        base: {
          source: "upstream",
          upstream: "origin/main",
          notice: null,
          replayed: 2,
          skipped: 0,
          carried: 0,
        },
      },
    ]) {
      const host = commands();
      const started = startWork(host.fake, draft, "web");
      host.finish()?.resolve(result);
      await started;
      expect(useStartStore.getState().pending?.baseNotice).toBeNull();
    }
  });

  it("returns to the start screen with the instruction and the failure", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    host.finish()?.reject(new RequestFailure("provider_cli_unavailable"));
    await started;
    expect(useStartStore.getState()).toMatchObject({
      pending: null,
      error: { code: "provider_cli_unavailable", stage: null },
      draft: { instruction: "Fix the build" },
    });
  });

  it("keeps a code it has no message for and the core's stage", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    host.finish()?.reject(new RequestFailure("worktree_locked", { stage: "worktree" }));
    await started;
    expect(useStartStore.getState().error).toEqual({ code: "worktree_locked", stage: "worktree" });
  });

  it("selects nothing when the user moved on before the workspace existed", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    useStartStore.setState({ pending: null });
    host.finish()?.resolve({ workspaceId: "wks_1" });
    await started;
    expect(useWorkspaceStore.getState().selected).toBeNull();
  });
});

describe("starting work in a team without a Product Owner", () => {
  it("hires the proposed Product Owner first and starts the conversation with it", async () => {
    const asked: [string, Record<string, unknown> | undefined][] = [];
    const fake = {
      run(command: string, arguments_?: Record<string, unknown>) {
        asked.push([command, arguments_]);
        if (command === "agent.hire")
          return Promise.resolve({ projectId: "prj_1", agent: { agentId: "agt_po" } });
        if (command === "workspace.start") return Promise.resolve({ workspaceId: "wks_1" });
        if (command === "agents.list")
          return Promise.resolve({ projectId: "prj_1", agents: [], roles: [] });
        if (command === "workspace.list") return Promise.resolve({ workspaces: [] });
        return Promise.resolve({ repositories: [] });
      },
    } as unknown as ApplicationCommands;
    await startWork(fake, { ...draft, participants: ["hire:product-owner", "agt_dev"] }, "web");
    expect(asked.find(([command]) => command === "agent.hire")?.[1]).toEqual({
      projectId: "prj_1",
      role: "product-owner",
    });
    // The hired Product Owner takes the proposal's place and leads.
    expect(asked.find(([command]) => command === "workspace.start")?.[1]).toMatchObject({
      participants: ["agt_po", "agt_dev"],
    });
    expect(useStartStore.getState().pending?.hireFailure).toBeNull();
  });

  it("starts without the Product Owner a refused hire would have been, and keeps the code", async () => {
    const asked: [string, Record<string, unknown> | undefined][] = [];
    const fake = {
      run(command: string, arguments_?: Record<string, unknown>) {
        asked.push([command, arguments_]);
        if (command === "agent.hire")
          return Promise.reject(new RequestFailure("agent_headcount_exceeded"));
        if (command === "workspace.start") return Promise.resolve({ workspaceId: "wks_1" });
        if (command === "workspace.list") return Promise.resolve({ workspaces: [] });
        return Promise.resolve({ repositories: [] });
      },
    } as unknown as ApplicationCommands;
    await startWork(fake, { ...draft, participants: ["hire:product-owner", "agt_dev"] }, "web");
    expect(asked.find(([command]) => command === "workspace.start")?.[1]).toMatchObject({
      participants: ["agt_dev"],
    });
    expect(asked.some(([command]) => command === "agents.list")).toBe(false);
    expect(useStartStore.getState().pending).toMatchObject({
      workspaceId: "wks_1",
      hireFailure: "agent_headcount_exceeded",
    });
  });

  it("tells the conversation that its work started without the Product Owner", () => {
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: "en", messages: messagesFor("en") },
        createElement(StartNotice, {
          without: "product_owner",
          code: "agent_headcount_exceeded",
        }),
      ),
    );
    expect(html).toContain("Lervo");
    expect(html).toContain(
      "This work started without a Product Owner, because Lervo could not hire one (agent_headcount_exceeded).",
    );
  });

  it("keeps the failed step when the core could not set up the work's coordination", async () => {
    const host = commands();
    const started = startWork(host.fake, draft, "web");
    host.finish()?.resolve({
      workspaceId: "wks_1",
      coordination: { status: "unavailable", code: "coordination_unavailable", cause: "enoent" },
    });
    await started;
    expect(useStartStore.getState().pending?.coordinationFailure).toBe("enoent");
    // Active or inactive coordination, and an older core's result, say nothing.
    for (const coordination of [
      { status: "active" },
      { status: "inactive", code: "coordination_inactive" },
      undefined,
    ]) {
      const again = commands();
      const restarted = startWork(again.fake, draft, "web");
      again.finish()?.resolve({
        workspaceId: "wks_1",
        ...(coordination === undefined ? {} : { coordination }),
      });
      await restarted;
      expect(useStartStore.getState().pending?.coordinationFailure).toBeNull();
    }
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: "en", messages: messagesFor("en") },
        createElement(StartNotice, {
          without: "coordination",
          code: "enoent",
        }),
      ),
    );
    expect(html).toContain(
      "This work writes without claiming its paths, because Lervo could not set up its coordination (enoent).",
    );
  });
});

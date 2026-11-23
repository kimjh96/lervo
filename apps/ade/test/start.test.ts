import { beforeEach, describe, expect, it } from "vitest";

import { startWork } from "../src/features/start/model/start";
import { useStartStore } from "../src/features/start/model/store";
import { useWorkspaceStore } from "../src/features/workspaces";
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

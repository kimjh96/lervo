import { beforeEach, describe, expect, it } from "vitest";

import { bindStartDraft } from "../src/features/start/model/draft";
import { bindStart, surfaceOf } from "../src/features/start/model/surface";
import { useStartStore } from "../src/features/start/model/store";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import type { Workspace } from "../src/features/workspaces/model/types";

const workspace: Workspace = {
  workspaceId: "wks_1",
  projectId: "prj_1",
  repositoryName: "web",
  branch: "lervo/fix",
  title: null,
  provider: "claude",
  conversationMode: "native",
  sessionId: "ses_1",
  preparedAt: "2026-11-23T01:00:00Z",
};
const pending = (workspaceId: string | null) => ({
  id: 3,
  instruction: "Fix it",
  repositoryName: "web",
  workspaceId,
});

describe("the main surface", () => {
  it("shows the start screen, the pending workspace, or the selected workspace", () => {
    expect(surfaceOf(undefined, null)).toEqual({ kind: "start", key: "start", background: "none" });
    expect(surfaceOf(undefined, pending(null))).toMatchObject({ kind: "pending", key: "start-3" });
    expect(surfaceOf(workspace, null)).toMatchObject({
      kind: "workspace",
      key: "wks_1",
      continuing: null,
    });
  });

  it("keeps the pending view's key when the created workspace continues it", () => {
    expect(surfaceOf(workspace, pending("wks_1"))).toMatchObject({
      kind: "workspace",
      key: "start-3",
      continuing: { id: 3 },
    });
    expect(surfaceOf(workspace, pending("wks_2"))).toMatchObject({ key: "wks_1" });
  });

  it("shows a workspace last opened in the terminal as its native conversation", () => {
    const cli = { ...workspace, conversationMode: "cli" as const };
    expect(surfaceOf(cli, null).key).toBe(surfaceOf(workspace, null).key);
    expect(surfaceOf(cli, null).background).toBe("native");
  });
});

describe("settling the pending start", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ selected: null, newWorkRequests: 0 });
    useStartStore.setState({ pending: pending("wks_1") });
  });

  it("keeps it for the workspace it created and settles it for any other or for new work", () => {
    const unbind = bindStart();
    useWorkspaceStore.getState().select("wks_1");
    expect(useStartStore.getState().pending).not.toBeNull();
    useWorkspaceStore.getState().select("wks_2");
    expect(useStartStore.getState().pending).toBeNull();
    useStartStore.setState({ pending: pending("wks_1") });
    useWorkspaceStore.getState().newWork();
    expect(useStartStore.getState().pending).toBeNull();
    unbind();
  });
});

describe("the start screen's draft", () => {
  it("restores the stored instruction and stores each change", () => {
    const stored = new Map([["start", "Fix the login page"]]);
    const drafts = {
      read: (key: string) => stored.get(key) ?? "",
      write: (key: string, text: string) => void stored.set(key, text),
    };
    useStartStore.setState({ draft: { instruction: "", repository: "", provider: "claude" } });
    const unbind = bindStartDraft(drafts);
    expect(useStartStore.getState().draft.instruction).toBe("Fix the login page");
    useStartStore.setState((store) => ({ draft: { ...store.draft, instruction: "" } }));
    expect(stored.get("start")).toBe("");
    unbind();
  });
});

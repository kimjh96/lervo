import { afterEach, describe, expect, it } from "vitest";

import { bindProfile, openProfile, useAgentStore } from "../src/features/agents";
import { surfaceOf } from "../src/features/start/model/surface";
import { useWorkspaceStore } from "../src/features/workspaces";

const unbind: (() => void)[] = [];
afterEach(() => {
  for (const stop of unbind.splice(0)) stop();
  useAgentStore.setState({ profile: null, projectId: null });
  useWorkspaceStore.setState({ selected: null });
});

describe("an agent's profile", () => {
  it("takes the main area while no conversation is chosen", () => {
    expect(surfaceOf(undefined, null, "agt_1")).toMatchObject({ kind: "agent", agentId: "agt_1" });
    expect(surfaceOf(undefined, null, null).kind).toBe("start");
  });

  it("closes when the person turns to a conversation, new work, or another project", () => {
    unbind.push(bindProfile());
    openProfile("agt_1");
    expect(useAgentStore.getState().profile).toBe("agt_1");
    expect(useWorkspaceStore.getState().selected).toBeNull();
    useWorkspaceStore.getState().select("wsp_1");
    expect(useAgentStore.getState().profile).toBeNull();
    openProfile("agt_1");
    useWorkspaceStore.getState().newWork();
    expect(useAgentStore.getState().profile).toBeNull();
    openProfile("agt_1");
    useAgentStore.setState({ projectId: "prj_2" });
    expect(useAgentStore.getState().profile).toBeNull();
  });
});

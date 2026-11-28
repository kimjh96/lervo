import { workspaceStartCoordinationSchema } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { COORDINATION_STAGE_ENABLED, coordinationStageOverride } from "../src/coordination-gate.js";
import {
  coordinateConversationWorkspace,
  type WorkspaceCoordinationPorts,
} from "../src/workspace-coordination.js";

const request = {
  repositoryRoot: "/work/app",
  workspacePath: "/workspaces/app/log-format-1a2b3c",
  conversationId: "wsp_0123456789abcdef01234567",
  workstreamId: "wks_0123456789abcdef01234567",
  leadAgentId: `agt_${"1".repeat(24)}`,
  provider: "claude",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
};

function ports(
  overrides: Partial<WorkspaceCoordinationPorts> = {},
): WorkspaceCoordinationPorts & { established: number } {
  const value = {
    established: 0,
    stageEnabled: async () => true,
    writerSchemaVersion: async () => 16,
    hookRuntimeCurrent: async () => true,
    hubCoordinated: async () => false,
    async establish() {
      value.established += 1;
    },
    ...overrides,
  };
  return value;
}

describe("the coordination stage", () => {
  it("binds the conversation only when the writer selects 16 and no Hub reserves its paths", async () => {
    const active = ports();
    expect(await coordinateConversationWorkspace(request, active)).toEqual({ status: "active" });
    expect(active.established).toBe(1);

    for (const version of [1, 14, 15]) {
      const below = ports({ writerSchemaVersion: async () => version });
      expect(await coordinateConversationWorkspace(request, below)).toEqual({
        status: "inactive",
        code: "coordination_inactive",
      });
      expect(below.established).toBe(0);
    }
    // A closed gate records nothing, whatever the writer selects.
    const closed = ports({ stageEnabled: async () => false });
    expect(await coordinateConversationWorkspace(request, closed)).toEqual({
      status: "inactive",
      code: "coordination_inactive",
    });
    expect(closed.established).toBe(0);
    expect(COORDINATION_STAGE_ENABLED).toBe(true);
    expect(coordinationStageOverride({})).toBeNull();
    expect(coordinationStageOverride({ LERVO_COORDINATION: "1" })).toBe(true);
    expect(coordinationStageOverride({ LERVO_COORDINATION: "0" })).toBe(false);
    expect(coordinationStageOverride({ LERVO_COORDINATION: "true" })).toBeNull();

    // A host whose installed hook runtime predates conversation workspaces records nothing: its
    // hooks would read the record as a worker's and block the first prompt.
    let runtimeRead = 0;
    const stale = ports({
      hookRuntimeCurrent: async () => {
        runtimeRead += 1;
        return false;
      },
    });
    expect(await coordinateConversationWorkspace(request, stale)).toEqual({
      status: "inactive",
      code: "hook_runtime_stale",
    });
    expect(stale.established).toBe(0);
    // A closed gate never reads the runtime, so an ordinary checkout pays nothing for it.
    await coordinateConversationWorkspace(
      request,
      ports({
        stageEnabled: async () => false,
        hookRuntimeCurrent: async () => {
          runtimeRead += 1;
          return false;
        },
      }),
    );
    expect(runtimeRead).toBe(1);

    const hub = ports({ hubCoordinated: async () => true });
    expect(await coordinateConversationWorkspace(request, hub)).toEqual({
      status: "inactive",
      code: "hub_coordinated_unsupported",
    });
    expect(hub.established).toBe(0);
  });

  it("reports a failed step as unavailable with its code instead of failing the start", async () => {
    const failed = (error: unknown) =>
      coordinateConversationWorkspace(
        request,
        ports({
          establish: async () => {
            throw error;
          },
        }),
      );
    expect(await failed(Object.assign(new Error("busy"), { code: "workforce_busy" }))).toEqual({
      status: "unavailable",
      code: "coordination_unavailable",
      cause: "workforce_busy",
    });
    expect(await failed(Object.assign(new Error("gone"), { code: "ENOENT" }))).toMatchObject({
      cause: "enoent",
    });
    expect(await failed(new Error("no code"))).toMatchObject({ cause: "command_failed" });
    expect(
      await coordinateConversationWorkspace(
        request,
        ports({
          hubCoordinated: async () => {
            throw Object.assign(new Error("config"), { code: "reader_inventory_config_invalid" });
          },
        }),
      ),
    ).toMatchObject({ status: "unavailable", cause: "reader_inventory_config_invalid" });
  });

  it("answers in shapes the session-host contract accepts", async () => {
    const { status, code, cause } = workspaceStartCoordinationSchema.properties;
    for (const result of [
      { status: "active" },
      { status: "inactive", code: "coordination_inactive" },
      { status: "inactive", code: "hub_coordinated_unsupported" },
      { status: "inactive", code: "hook_runtime_stale" },
      { status: "unavailable", code: "coordination_unavailable", cause: "enoent" },
    ] as Array<{ status: string; code?: string; cause?: string }>) {
      expect(new RegExp(status.pattern, "u").test(result.status)).toBe(true);
      if (result.code !== undefined)
        expect(new RegExp(code.pattern, "u").test(result.code)).toBe(true);
      if (result.cause !== undefined)
        expect(new RegExp(cause.pattern, "u").test(result.cause)).toBe(true);
    }
  });
});

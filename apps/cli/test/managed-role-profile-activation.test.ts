import type { ProjectStorage } from "@lervo/project-storage";
import { getBuiltInRoleDefinition, type ResolvedRoleContract } from "@lervo/roles";
import { describe, expect, it, vi } from "vitest";

import { recordManagedRoleProfileActivation } from "../src/managed-role-profile-activation.js";

const roleContract = {
  schemaVersion: 1,
  roleId: "developer",
  version: "1.0.0",
  contractHash: `sha256:${"1".repeat(64)}`,
  sourceKind: "built_in",
  sourcePath: null,
  extends: [],
  definition: getBuiltInRoleDefinition("developer"),
} satisfies ResolvedRoleContract;

function storageFor(version: 1 | 2, append: ReturnType<typeof vi.fn>): ProjectStorage {
  return {
    writableEventSchemaVersion: version,
    manifest: { projectId: "prj_profile_activation" },
    events: { append },
  } as unknown as ProjectStorage;
}

describe("managed role-profile activation", () => {
  it("leaves writer-v1 managed runs eligible to continue without profile evidence", () => {
    const append = vi.fn();
    const createEventId = vi.fn(() => "evt_profile_activation");

    expect(
      recordManagedRoleProfileActivation({
        storage: storageFor(1, append),
        runId: "run_profile_activation",
        sessionId: "ses_profile_activation",
        provider: "codex",
        roleContract,
        runtimeProfileHash: `sha256:${"2".repeat(64)}`,
        activatedAt: "2026-09-06T00:00:00.000Z",
        createEventId,
      }),
    ).toBe(false);
    expect(append).not.toHaveBeenCalled();
    expect(createEventId).not.toHaveBeenCalled();
  });

  it("records exact profile evidence when writer v2 is selected", () => {
    const append = vi.fn();

    expect(
      recordManagedRoleProfileActivation({
        storage: storageFor(2, append),
        runId: "run_profile_activation",
        sessionId: "ses_profile_activation",
        provider: "claude",
        roleContract,
        runtimeProfileHash: `sha256:${"2".repeat(64)}`,
        activatedAt: "2026-09-06T00:00:00.000Z",
        createEventId: () => "evt_profile_activation",
      }),
    ).toBe(true);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_profile_activation",
        schemaVersion: 2,
        type: "role.profile.activated",
        payload: expect.objectContaining({
          provider: "claude",
          roleId: "developer",
          roleVersion: "1.0.0",
        }),
      }),
    );
  });
});

import { describe, expect, it } from "vitest";

import { observeWorkspaceWriterLiveness, type AgentWorkspace } from "../src/index.js";

const workspace = {
  writerSession: {
    sessionId: "ses_terminal_writer_one",
    startedAt: "2026-09-04T00:00:00.000Z",
    lastSeenAt: "2026-09-04T00:01:00.000Z",
  },
} as AgentWorkspace;

describe("workspace writer liveness", () => {
  it("distinguishes recent and stale observations without releasing authority", () => {
    expect(
      observeWorkspaceWriterLiveness({
        workspace,
        observedAt: new Date("2026-09-04T00:02:00.000Z"),
      }),
    ).toMatchObject({ status: "recently_observed", ageMs: 60_000, releasesWriterAuthority: false });
    expect(
      observeWorkspaceWriterLiveness({
        workspace,
        observedAt: new Date("2026-09-04T00:04:00.001Z"),
      }),
    ).toMatchObject({
      status: "stale_observation",
      ageMs: 180_001,
      releasesWriterAuthority: false,
    });
  });

  it("keeps legacy and absent writers explicit", () => {
    expect(
      observeWorkspaceWriterLiveness({
        workspace: {
          ...workspace,
          writerSession: { sessionId: "ses_legacy_writer", startedAt: "2026-09-04T00:00:00.000Z" },
        },
        observedAt: new Date("2026-09-04T00:04:00.001Z"),
      }).status,
    ).toBe("legacy_unknown");
    expect(
      observeWorkspaceWriterLiveness({
        workspace: { ...workspace, writerSession: null },
        observedAt: new Date("2026-09-04T00:04:00.001Z"),
      }).status,
    ).toBe("absent");
  });
});

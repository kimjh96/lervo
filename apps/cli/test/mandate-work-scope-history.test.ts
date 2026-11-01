import type { EventEnvelope } from "@lervo/schemas";
import { selectOperatingWorkScope } from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";

import { longHistoryEvents } from "../../../packages/storage-contract/test/listed-event-source.fixture.js";
import {
  assignment,
  causalityPayload,
  event,
  projectId,
  workstreamId,
} from "../../../packages/work-controller/test/fixtures.js";

const ports = vi.hoisted(() => ({ storage: null as unknown }));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<typeof import("@lervo/project-storage")>()),
  openProjectStorage: async () => ports.storage,
}));
vi.mock("@lervo/agent-workforce", async (original) => ({
  ...(await original<typeof import("@lervo/agent-workforce")>()),
  listAssignments: async () => [],
}));
vi.mock("@lervo/repository-knowledge", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge")>()),
  readCurrentWorkstreamState: async () => null,
}));

const { selectRepositoryMandateWorkScope } = await import("../src/mandate-installation.js");

function snapshot(sequence: number): EventEnvelope {
  return {
    ...event(sequence, "workstream.snapshot.recorded", `run_scope${sequence}`, {
      workstreamId,
      snapshotContentHash: `sha256:${String(sequence).repeat(64)}`,
    }),
    eventHash: `sha256:${String(sequence).repeat(64)}`,
  };
}

afterEach(() => {
  ports.storage = null;
});

describe("mandate work-scope selection over long history", () => {
  it("selects the safe snapshot beyond 100,000 events from the work-scope types only", async () => {
    const anchor = snapshot(1);
    const unfinished = event(
      2,
      "work.causality.recorded",
      "run_unfinished0001",
      causalityPayload({ assignmentId: assignment("1").assignmentId }),
    );
    const newest = snapshot(3);
    const long = longHistoryEvents([anchor, unfinished, newest]);
    ports.storage = {
      manifest: { projectId },
      events: { list: long.list, latest: () => long.head },
      close: async () => undefined,
    };

    const scope = await selectRepositoryMandateWorkScope({ root: "/repository", workstreamId });

    // The newer snapshot cannot exclude the unfinished causal work recorded before it.
    expect(scope).toEqual({
      schemaVersion: 1,
      workstreamId,
      snapshotEventId: anchor.eventId,
      snapshotEventHash: anchor.eventHash,
      excludedAssignments: [],
    });
    expect(scope).toEqual(
      selectOperatingWorkScope({ projectId, workstreamId, events: long.events, assignments: [] }),
    );
  });
});

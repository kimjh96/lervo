import { ImprovementObservationPortError } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { expect, it, vi } from "vitest";

import { createProjectStorageImprovementEvidenceSource } from "../src/index.js";

const hash = `sha256:${"b".repeat(64)}`;
const projectId = "prj_project_source_fixture";
const window = {
  startedAt: "2026-09-02T00:00:00.000Z",
  endedAt: "2026-09-02T00:00:10.000Z",
};

function fixtureEvent(seq: number): EventEnvelope {
  return {
    eventId: `evt_projectsource${seq}`,
    projectId,
    runId: "run_projectsource",
    sessionId: "ses_projectsource",
    seq,
    type: "run.requested",
    occurredAt: "2026-09-02T00:00:01.000Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: {},
    previousHash: seq === 1 ? null : hash,
    eventHash: hash,
  } as EventEnvelope;
}

function storage(input: { events: EventEnvelope[]; close: () => Promise<void> }): ProjectStorage {
  return {
    manifest: { projectId },
    events: {
      latest: () => input.events.at(-1) ?? null,
      list: (options?: { afterSeq?: number; limit?: number }) =>
        input.events
          .filter((event) => event.seq > (options?.afterSeq ?? 0))
          .slice(0, options?.limit ?? 1_000),
    },
    close: input.close,
  } as unknown as ProjectStorage;
}

it("closes project storage after a successful bounded read", async () => {
  const close = vi.fn(async () => undefined);
  const source = createProjectStorageImprovementEvidenceSource({
    repositoryRoot: "/fixture",
    openStorage: async () => storage({ events: [fixtureEvent(1)], close }),
  });

  await expect(source.readWindow(window)).resolves.toMatchObject({ projectId, events: [] });
  expect(close).toHaveBeenCalledOnce();
});

it("preserves read and close failures as one unavailable-source failure", async () => {
  const closeFailure = new Error("close failed");
  const source = createProjectStorageImprovementEvidenceSource({
    repositoryRoot: "/fixture",
    maximumScannedEvents: 1,
    openStorage: async () =>
      storage({
        events: [fixtureEvent(1), fixtureEvent(2)],
        close: async () => {
          throw closeFailure;
        },
      }),
  });

  let failure: unknown;
  try {
    await source.readWindow(window);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: "evidence_unavailable" });
  expect(failure).toBeInstanceOf(ImprovementObservationPortError);
  expect((failure as ImprovementObservationPortError).cause).toBeInstanceOf(AggregateError);
  expect(
    ((failure as ImprovementObservationPortError).cause as AggregateError).errors,
  ).toHaveLength(2);
});

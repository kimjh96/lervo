import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import { isProvenPreTurnFailure } from "../src/supervision-pre-turn-failure.js";
import { readProvenPreTurnFailure } from "../src/supervision-pre-turn-failure-source.js";
import { observeSupervisionFailure } from "../src/supervision-failure-observation.js";

const prefix = [
  "managed.execution.reserved",
  "work.causality.recorded",
  "run.requested",
  "run.resolved",
  "role.input.bound",
] as const;
const times = [
  "2026-09-12T23:13:09.182Z",
  "2026-09-12T23:13:20.989Z",
  "2026-09-12T23:13:20.989Z",
  "2026-09-12T23:13:20.989Z",
  "2026-09-12T23:13:21.130Z",
];

function fixture() {
  const events = [
    ...prefix.map(
      (type, index) =>
        ({
          type,
          seq: 10578 + index,
          eventId: `evt_${String(index + 1).padStart(32, "0")}`,
          eventHash: `sha256:${String(index + 1).repeat(64)}`,
          projectId: "prj_ab094111596346d7",
          runId: "run_f91fb364af05def51ad2af41315848c1",
          sessionId: "ses_f91fb364af05def51ad2af41315848c1",
          occurredAt: times[index],
          payload: {},
        }) as EventEnvelope,
    ),
    {
      type: "run.failed",
      seq: 11337,
      eventId: "evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      eventHash: `sha256:${"e".repeat(64)}`,
      projectId: "prj_ab094111596346d7",
      runId: "run_f91fb364af05def51ad2af41315848c1",
      sessionId: "ses_f91fb364af05def51ad2af41315848c1",
      occurredAt: "2026-09-13T16:28:09.176Z",
      schemaVersion: 1,
      actor: { kind: "system" },
      payload: { failureCode: "interrupted_before_turn", retryable: true },
    } as unknown as EventEnvelope,
  ];
  const diagnostic = {
    schemaVersion: 1,
    kind: "work.managed_pre_turn_failure",
    failures: [{ code: "interrupted_before_turn", phase: "recovery", retryable: true }],
    runEvents: events.slice(0, 5).map((event) => ({
      eventId: event.eventId,
      eventHash: event.eventHash,
      type: event.type,
    })),
    witness: {
      schemaVersion: 1,
      kind: "host.boot_transition_witness",
      incidentAt: times[4],
      incidentBootId: "d8a3ebc0a47e4c77ab640c5ee80d3859",
      incidentBootFirstAt: "2026-09-11T13:19:13Z",
      incidentBootLastAt: "2026-09-13T00:02:53Z",
      successorBootId: "b552af163c2b46f09529bebc40f770ed",
      successorBootFirstAt: "2026-09-13T00:03:42Z",
      currentBootId: "3200c4e926ab4e94bc6195b8b3911bc4",
      inventorySha256: `sha256:${"a".repeat(64)}`,
      observedAt: "2026-09-13T16:28:09.175Z",
    },
  };
  return { events, diagnostic };
}

it("proves only an exact pre-start run fenced by a later host boot", () => {
  const { events, diagnostic } = fixture();
  expect(isProvenPreTurnFailure(events, diagnostic)).toBe(true);
});

it("rejects a possible model turn or substituted historical event", () => {
  const { events, diagnostic } = fixture();
  expect(
    isProvenPreTurnFailure(
      [
        ...events.slice(0, -1),
        { ...events[4]!, type: "adapter.started" } as EventEnvelope,
        events.at(-1)!,
      ],
      diagnostic,
    ),
  ).toBe(false);
  expect(
    isProvenPreTurnFailure(events, {
      ...diagnostic,
      runEvents: [
        { ...diagnostic.runEvents[0], eventHash: "changed" },
        ...diagnostic.runEvents.slice(1),
      ],
    }),
  ).toBe(false);
});

it("rejects a boot boundary that does not enclose the request", () => {
  const { events, diagnostic } = fixture();
  expect(
    isProvenPreTurnFailure(events, {
      ...diagnostic,
      witness: { ...diagnostic.witness, incidentBootLastAt: "2026-09-12T23:13:19Z" },
    }),
  ).toBe(false);
});

it("counts a pre-turn failure only with its readable exact CAS diagnostic", async () => {
  const { events, diagnostic } = fixture();
  const bytes = new TextEncoder().encode(JSON.stringify(diagnostic));
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  events.at(-1)!.payload.diagnosticDigest = hash;
  const artifacts = {
    has: async (uri: string) => uri === `lervo-cas://sha256/${hash.slice(7)}`,
    get: async (uri: string) => {
      if (uri !== `lervo-cas://sha256/${hash.slice(7)}`) throw new Error("not found");
      return bytes;
    },
  } as ArtifactStore;
  expect(await readProvenPreTurnFailure(events, artifacts)).toBe(true);
  expect(await observeSupervisionFailure(events, artifacts)).toMatchObject({
    status: "known_safe_failure",
    reasonCode: "fenced_pre_turn_interruption",
  });
  const extra = [...events.slice(0, -1), { ...events[0]!, seq: 10583 }, events.at(-1)!];
  expect(await readProvenPreTurnFailure(extra, artifacts)).toBe(false);
  expect(await observeSupervisionFailure(extra, artifacts)).toMatchObject({ status: "uncertain" });
  events.at(-1)!.payload.diagnosticDigest = `sha256:${"0".repeat(64)}`;
  expect(await readProvenPreTurnFailure(events, artifacts)).toBe(false);
});

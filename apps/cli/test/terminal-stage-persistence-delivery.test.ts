import { expect, it, vi } from "vitest";

import type { ProjectStorage } from "@lervo/project-storage";
import type { TerminalHookDelivery } from "../src/terminal-hook-delivery.js";
import { recordTerminalStageObservation } from "../src/terminal-stage-persistence.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";

const hash = `sha256:${"a".repeat(64)}`;

async function record(writer: number, delivery: TerminalHookDelivery | undefined) {
  const append = vi.fn();
  const storage = {
    writableEventSchemaVersion: writer,
    manifest: { projectId: "prj_stage_delivery_1" },
    artifacts: { has: async () => true },
    events: { append },
  } as unknown as ProjectStorage;
  const timing = Object.assign(createTerminalStageObservation(hash), { delivery: () => delivery });
  await recordTerminalStageObservation({
    root: "/repository",
    coordinates: { runId: "run_stage_delivery_1", sessionId: "ses_stage_delivery_1" },
    observationId: "tobs_stagedelivery01",
    hookEvent: "UserPromptSubmit",
    timing,
    outcome: "completed",
    policyVersion: hash,
    storage,
  });
  return append.mock.calls[0]![0] as { schemaVersion: number; payload: Record<string, unknown> };
}

it("records how the answer was delivered once the writer is at schema 13", async () => {
  const served = { channel: "context_server", answerMilliseconds: 84 } as const;
  const event = await record(13, served);
  expect(event.schemaVersion).toBe(13);
  expect(event.payload.delivery).toEqual(served);
  const fallback = { channel: "in_process", fallback: "declined_busy" } as const;
  expect((await record(14, fallback)).payload.delivery).toEqual(fallback);
});

it("records the stages alone, as schema 2, for an older writer or no delivery", async () => {
  for (const [writer, delivery] of [
    [12, { channel: "context_server", answerMilliseconds: 84 }],
    [2, { channel: "in_process", fallback: "no_server" }],
    [13, undefined],
  ] as const) {
    const event = await record(writer, delivery);
    expect(event.schemaVersion).toBe(2);
    expect(event.payload).not.toHaveProperty("delivery");
  }
});

import { afterEach, describe, expect, it } from "vitest";

import { DeliberationRuntime } from "../src/index.js";
import {
  cleanupFixtures,
  clock,
  createRuntimeFixture,
  deliberationId,
  policy,
  policyVersion,
  projectId,
  sequence,
} from "./fixture.js";

afterEach(cleanupFixtures);

describe("deliberation runtime snapshot restoration", () => {
  it("normalizes malformed nested snapshot values to the controlled snapshot failure", async () => {
    const fixture = await createRuntimeFixture();
    const now = clock();
    const options = {
      deliberationId,
      policy,
      policyVersion,
      coordinates: {
        projectId,
        runId: "run_deliberation_control",
        sessionId: "ses_deliberation_control",
      },
      events: fixture.events,
      artifactStore: fixture.artifacts,
      now,
      createEventId: sequence("evt_deliberation"),
    };
    const original = new DeliberationRuntime(options);
    original.start();
    const malformed = original.snapshot();
    malformed.recordedEvents = [null] as unknown as typeof malformed.recordedEvents;

    expect(
      () =>
        new DeliberationRuntime({
          ...options,
          resumeSnapshot: malformed,
        }),
    ).toThrow(
      expect.objectContaining({
        code: "runtime_state_invalid",
        reason: "runtime_snapshot_invalid",
      }),
    );
    expect(() => new DeliberationRuntime(options).start()).toThrow(/already been admitted/u);
    fixture.events.close();
  });
});

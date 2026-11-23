import { expect, it } from "vitest";

import { continuityHostPort } from "../src/continuity-hub-port.js";
import { readHostModelSelection } from "../src/model-selection-host.js";

const manifest = {
  schemaVersion: 1,
  projectId: "prj_model_exchange",
  createdAt: "2026-11-23T00:00:00.000Z",
};

it("adopts a newer model selection a peer host publishes when it lists host records (ADR-0612 M3)", async () => {
  const peer = {
    hostHash: `sha256:${"2".repeat(64)}`,
    modelSelection: {
      schemaVersion: 1,
      revision: 4,
      changedAt: "2026-01-02T06:00:00.000Z",
      roles: { review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }] },
    },
  };
  // This host's own stale copy is newer than the peer's, but it is never adopted back.
  const ownStale = {
    hostHash: `sha256:${"1".repeat(64)}`,
    modelSelection: { ...peer.modelSelection, revision: 9, changedAt: "2026-01-02T06:30:00.000Z" },
  };
  const { port, failureCode } = await continuityHostPort(
    {
      hostHash: `sha256:${"1".repeat(64)}`,
      config: { coordination: { mode: "hub", hub: {} } },
    } as never,
    async () =>
      ({
        publish: async () => "created",
        list: async () => [ownStale, peer],
      }) as never,
    { manifest } as never,
  );
  expect(failureCode).toBeNull();
  expect(await port!.list()).toEqual([ownStale, peer]);
  expect((await readHostModelSelection()).selection).toMatchObject({
    revision: 4,
    changedAt: "2026-01-02T06:00:00.000Z",
    roles: { review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }] },
  });
});

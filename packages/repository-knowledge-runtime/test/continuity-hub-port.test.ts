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
      changedAt: "2026-11-23T06:00:00.000Z",
      roles: { review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }] },
    },
  };
  const { port, failureCode } = await continuityHostPort(
    {
      hostHash: `sha256:${"1".repeat(64)}`,
      config: { coordination: { mode: "hub", hub: {} } },
    } as never,
    async () =>
      ({
        publish: async () => "created",
        list: async () => [peer],
      }) as never,
    { manifest } as never,
  );
  expect(failureCode).toBeNull();
  expect(await port!.list()).toEqual([peer]);
  expect((await readHostModelSelection()).selection).toMatchObject({
    revision: 4,
    changedAt: "2026-11-23T06:00:00.000Z",
    roles: { review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }] },
  });
});

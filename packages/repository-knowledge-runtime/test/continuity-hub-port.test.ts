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

it("publishes again without the selection when a Hub older than ADR-0612 M3 rejects it", async () => {
  const published: Array<Record<string, unknown>> = [];
  const { port } = await continuityHostPort(
    {
      hostHash: `sha256:${"1".repeat(64)}`,
      config: { coordination: { mode: "hub", hub: {} } },
    } as never,
    async () =>
      ({
        publish: async (record: Record<string, unknown>) => {
          published.push(record);
          if (record.modelSelection !== undefined)
            throw Object.assign(new Error("invalid"), { httpStatus: 400 });
          return "updated";
        },
        list: async () => [],
      }) as never,
    { manifest } as never,
  );
  const record = { hostHash: "h", modelSelection: { revision: 1 } } as never;
  await expect(port!.publish(record)).resolves.toBe("updated");
  expect(published.map((item) => "modelSelection" in item)).toEqual([true, false]);
  // This process now withholds the selection from that Hub: one request per publish.
  await port!.publish(record);
  expect(published.map((item) => "modelSelection" in item)).toEqual([true, false, false]);
  // Any other failure is reported as before.
  const failing = await continuityHostPort(
    { hostHash: "h", config: { coordination: { mode: "hub", hub: {} } } } as never,
    async () =>
      ({
        publish: async () => {
          throw Object.assign(new Error("down"), { httpStatus: 503 });
        },
        list: async () => [],
      }) as never,
    { manifest } as never,
  );
  await expect(failing.port!.publish(record)).rejects.toThrow("down");
});

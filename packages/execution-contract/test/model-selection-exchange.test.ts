import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adoptModelSelection,
  isNewerModelSelection,
  modelSelectionPath,
  parseModelSelection,
  readModelSelection,
  transportedModelSelection,
  writeModelSelectionRole,
} from "../src/index.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "lervo-model-exchange-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const selection = (revision: number, changedAt: string, model: string) =>
  parseModelSelection({
    schemaVersion: 1,
    revision,
    changedAt,
    roles: { routine: [{ provider: "claude", model, reasoningEffort: null }] },
  });

describe("model selection exchange (ADR-0612 M3)", () => {
  it("orders by change time, then revision, then content, so both hosts agree", () => {
    const early = selection(9, "2026-11-23T01:00:00.000Z", "a");
    const late = selection(1, "2026-11-23T02:00:00.000Z", "a");
    expect(isNewerModelSelection(late, early)).toBe(true);
    expect(isNewerModelSelection(early, late)).toBe(false);
    const sameTime = selection(2, "2026-11-23T02:00:00.000Z", "a");
    expect(isNewerModelSelection(sameTime, late)).toBe(true);
    const x = selection(1, "2026-11-23T02:00:00.000Z", "x");
    expect(isNewerModelSelection(x, late) !== isNewerModelSelection(late, x)).toBe(true);
  });

  it("publishes nothing for a host that never chose", async () => {
    expect(transportedModelSelection((await readModelSelection(directory)).selection)).toBeNull();
  });

  it("adopts a newer peer selection with its own revision and change time, and only once", async () => {
    await writeModelSelectionRole({
      stateDirectory: directory,
      role: "routine",
      routes: [{ provider: "claude", model: "local", reasoningEffort: null }],
      now: new Date("2026-11-23T01:00:00.000Z"),
    });
    const peer = {
      schemaVersion: 1,
      revision: 7,
      changedAt: "2026-11-23T03:00:00.000Z",
      roles: {
        routine: [{ provider: "claude", model: "peer", reasoningEffort: null }],
        future_role: [{ provider: "claude", model: null, reasoningEffort: null }],
      },
    };
    await expect(
      adoptModelSelection({
        stateDirectory: directory,
        candidate: peer,
        now: new Date("2026-11-23T04:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "adopted",
    });
    const adopted = (await readModelSelection(directory)).selection;
    expect(adopted).toMatchObject({ revision: 7, changedAt: "2026-11-23T03:00:00.000Z" });
    expect(adopted.roles.routine?.[0]?.model).toBe("peer");
    // A role a newer Lervo defines travels on unchanged.
    expect(transportedModelSelection(adopted)?.roles.future_role).toEqual(peer.roles.future_role);
    await expect(
      adoptModelSelection({
        stateDirectory: directory,
        candidate: peer,
        now: new Date("2026-11-23T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      status: "current",
    });
  });

  it("keeps a newer local selection, and never overwrites an unusable file", async () => {
    await writeModelSelectionRole({
      stateDirectory: directory,
      role: "routine",
      routes: [{ provider: "claude", model: "local", reasoningEffort: null }],
      now: new Date("2026-11-23T05:00:00.000Z"),
    });
    const older = transportedModelSelection(selection(9, "2026-11-23T04:00:00.000Z", "peer"));
    await expect(
      adoptModelSelection({
        stateDirectory: directory,
        candidate: older,
        now: new Date("2026-11-23T05:00:00.000Z"),
      }),
    ).resolves.toEqual({
      status: "current",
    });
    await writeFile(modelSelectionPath(directory), "{ broken", { mode: 0o600 });
    const newer = transportedModelSelection(selection(9, "2026-11-23T09:00:00.000Z", "peer"));
    await expect(
      adoptModelSelection({
        stateDirectory: directory,
        candidate: newer,
        now: new Date("2026-11-23T09:00:00.000Z"),
      }),
    ).resolves.toEqual({
      status: "rejected",
    });
    expect(await readFile(modelSelectionPath(directory), "utf8")).toBe("{ broken");
  });
});

describe("model selection exchange safety (ADR-0612 M3)", () => {
  it("refuses a peer change stamped far ahead of this host's clock", async () => {
    const now = new Date("2026-11-23T05:00:00.000Z");
    const ahead = transportedModelSelection(selection(2, "2026-11-23T06:00:00.000Z", "peer"));
    await expect(
      adoptModelSelection({ stateDirectory: directory, candidate: ahead, now }),
    ).resolves.toEqual({ status: "rejected" });
    const close = transportedModelSelection(selection(2, "2026-11-23T05:05:00.000Z", "peer"));
    await expect(
      adoptModelSelection({ stateDirectory: directory, candidate: close, now }),
    ).resolves.toMatchObject({ status: "adopted" });
  });

  it("stamps a local change after the selection it replaces, even behind a peer's clock", async () => {
    await adoptModelSelection({
      stateDirectory: directory,
      candidate: transportedModelSelection(selection(5, "2026-11-23T05:05:00.000Z", "peer")),
      now: new Date("2026-11-23T05:00:00.000Z"),
    });
    const next = await writeModelSelectionRole({
      stateDirectory: directory,
      role: "routine",
      routes: [{ provider: "claude", model: "local", reasoningEffort: null }],
      now: new Date("2026-11-23T05:01:00.000Z"),
    });
    expect(next.changedAt).toBe("2026-11-23T05:05:00.001Z");
  });

  it("refuses a lenient timestamp and a deep or oversized role a newer Lervo might send", () => {
    const base = { schemaVersion: 1, revision: 1, roles: {} };
    expect(() =>
      parseModelSelection({ ...base, changedAt: "+275760-09-13T00:00:00.000Z" }),
    ).toThrow();
    expect(() => parseModelSelection({ ...base, changedAt: "2026-11-23" })).toThrow();
    let deep: unknown = "x";
    for (let index = 0; index < 50; index += 1) deep = { nested: deep };
    expect(() =>
      parseModelSelection({
        ...base,
        changedAt: "2026-11-23T05:00:00.000Z",
        roles: { future_role: [{ provider: "claude", model: deep, reasoningEffort: null }] },
      }),
    ).toThrow();
  });
});

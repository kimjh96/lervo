import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { OutcomeSupervisionCycleResult } from "@lervo/orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FULL_OBSERVATION_INTERVAL_MS,
  SupervisionObservationGate,
} from "../src/supervision-observation-gate.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const unchanged: OutcomeSupervisionCycleResult = { disposition: "idle", report: null };

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-observation-gate-"));
  roots.push(root);
  const tree = resolve(root, "assignments");
  await mkdir(tree);
  await writeFile(resolve(tree, "asn_1.json"), "{}");
  await writeFile(resolve(root, "agents.json"), "{}");
  const state = {
    head: { seq: 7, eventHash: `sha256:${"a".repeat(64)}` } as { seq: number; eventHash: string },
    deadlines: [] as (number | null)[],
    now: 1_000_000,
    auditFails: false,
  };
  const audit = vi.fn(async () => {
    if (state.auditFails) throw new Error("audit unavailable");
  });
  const gate = new SupervisionObservationGate(
    {
      head: () => state.head,
      paths: async () => ({ files: [resolve(root, "agents.json")], trees: [tree] }),
      deadlines: () => state.deadlines,
      auditHistory: audit,
    },
    () => state.now,
  );
  const cycle = vi.fn(async () => unchanged);
  // The first cycle observes; the second sees the same source and settles it.
  await gate.run(cycle);
  return { root, tree, state, audit, gate, cycle };
}

describe("supervision observation gate", () => {
  it("skips only a wake-up that would repeat an unchanged observation, and still audits", async () => {
    const f = await fixture();
    expect(await f.gate.run(f.cycle)).toEqual(unchanged);
    expect(await f.gate.run(f.cycle)).toEqual(unchanged);
    expect(f.cycle).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledTimes(2);
  });

  it("observes after a hint, a new event or a changed input file", async () => {
    const f = await fixture();
    f.gate.invalidate();
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(2);

    f.state.head = { seq: 8, eventHash: `sha256:${"b".repeat(64)}` };
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(3);

    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(3);
    await writeFile(resolve(f.tree, "asn_2.json"), "{}");
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(4);

    await writeFile(resolve(f.root, "agents.json"), '{"agents":[]}');
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(5);
  });

  it("observes when a duty deadline lapses or the full interval passes", async () => {
    const f = await fixture();
    f.state.deadlines = [null, f.state.now + 10];
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(1);
    f.state.now += 10;
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(2);

    f.state.deadlines = [];
    f.state.now += FULL_OBSERVATION_INTERVAL_MS - 1;
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(2);
    f.state.now += 1;
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(3);

    f.state.now -= 5;
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(4);
  });

  it("observes when the audit fails or the last cycle did not settle unchanged", async () => {
    const f = await fixture();
    f.state.auditFails = true;
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(2);
    f.state.auditFails = false;

    // Each case starts from a hint so the cycle under test runs.
    f.gate.invalidate();
    f.cycle.mockResolvedValueOnce({ disposition: "busy", report: null });
    await f.gate.run(f.cycle);
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(4);

    const report = {} as NonNullable<OutcomeSupervisionCycleResult["report"]>;
    f.gate.invalidate();
    f.cycle.mockResolvedValueOnce({ disposition: "idle", report });
    await f.gate.run(f.cycle);
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(6);

    f.gate.invalidate();
    f.cycle.mockRejectedValueOnce(new Error("observation failed"));
    await expect(f.gate.run(f.cycle)).rejects.toThrow("observation failed");
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(8);
  });

  it("observes again after a hint that arrives during a cycle", async () => {
    const f = await fixture();
    f.gate.invalidate();
    f.cycle.mockImplementationOnce(async () => {
      f.gate.invalidate();
      return unchanged;
    });
    await f.gate.run(f.cycle);
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(3);
  });

  it("never skips when its inputs exceed the stamped bound or cannot be read", async () => {
    const f = await fixture();
    for (let index = 0; index < 4_100; index += 1)
      await writeFile(resolve(f.tree, `asn_${index}_extra.json`), "");
    await f.gate.run(f.cycle);
    await f.gate.run(f.cycle);
    await f.gate.run(f.cycle);
    expect(f.cycle).toHaveBeenCalledTimes(4);

    const unreadable = new SupervisionObservationGate({
      head: () => null,
      paths: async () => {
        throw new Error("coordination home unavailable");
      },
      deadlines: () => [],
      auditHistory: async () => undefined,
    });
    const cycle = vi.fn(async () => unchanged);
    await unreadable.run(cycle);
    await unreadable.run(cycle);
    expect(cycle).toHaveBeenCalledTimes(2);
  });
});

import { readFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "yields after one provider call and resumes cached generation through independent review to currency",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const calls = async () =>
      (await readFile(f.log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    let result;
    for (let turn = 0; turn < 32; turn++) {
      const before = (await calls()).length;
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `quantum-${turn}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumProviderCallsPerTurn: 1,
      });
      expect((await calls()).length - before).toBeLessThanOrEqual(1);
      if (
        result.status === "processed" &&
        result.convergence.state === "idle" &&
        result.convergence.lastVerifiedCurrency !== null
      )
        break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    const requests = (await calls()).map((line) => JSON.parse(line).request);
    const normalizations = requests.filter((request) => request.envelope);
    expect(new Set(normalizations.map((request) => JSON.stringify(request.envelope))).size).toBe(
      normalizations.length,
    );
    expect(requests.some((request) => request.task === "independent_normalization_review")).toBe(
      true,
    );
  },
);

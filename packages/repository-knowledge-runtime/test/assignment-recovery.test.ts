import { readFile, writeFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { probeKnowledgeProviderAvailability } from "../src/provider-probe.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "returns a native quota failure lease and resumes the same assignment after an exact probe",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const original = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      original.replace(
        "if(request.envelope)",
        "if(request.task==='lifecycle_exact_plan_review'){console.log(JSON.stringify({type:'result',is_error:true,error:'quota_exceeded'}));process.exit(1);}\nif(request.envelope)",
      ),
    );
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "restart",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
    expect(await run()).toMatchObject({
      convergence: { state: "waiting_authority", reason: "knowledge_provider_paused" },
    });
    const failed = (await listAssignments(f.root)).find((item) => item.status === "failed")!;
    expect(failed).toMatchObject({
      lease: null,
      failureCode: "knowledge_provider_paused",
      lastLeaseGeneration: 1,
    });
    const calls = (await readFile(f.log, "utf8")).trim().split("\n").length;
    await run();
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls);
    await writeFile(f.executable, original);
    expect(
      await probeKnowledgeProviderAvailability({
        storage: f.storage,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      }),
    ).toMatchObject({ resumed: true });
    let result;
    for (let i = 0; i < 6; i++) {
      result = await run();
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result).toMatchObject({
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    const recovered = (await listAssignments(f.root)).find(
      (item) => item.assignmentId === failed.assignmentId,
    )!;
    expect(recovered).toMatchObject({
      status: "completed",
      lease: null,
      lastLeaseGeneration: 2,
      recovery: { kind: "retry", attemptNumber: 2 },
    });
    expect(f.events.get(recovered.recovery!.terminalEventId)).toMatchObject({
      type: "assignment.completed",
      payload: { status: "failed" },
    });
    expect((await listAssignments(f.root)).every((item) => item.lease === null)).toBe(true);
  },
);

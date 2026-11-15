import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listAssignments, listAgents } from "@lervo/agent-workforce";
import { providerCliDispatchContext } from "@lervo/repository-knowledge-compiler";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("discovers idle preexisting debt without a change job and records missing authority without calling a provider", async () => {
  const f = await fixture();
  fixtures.push(f);
  const run = () =>
    runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "fixture",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
  expect(await run()).toMatchObject({
    status: "processed",
    convergence: { state: "waiting_authority", reason: "knowledge_authority_unavailable" },
  });
  const count = f.events.list({ limit: 1000 }).length;
  expect(await run()).toMatchObject({ convergence: { state: "waiting_authority" } });
  expect(f.events.list({ limit: 1000 })).toHaveLength(count);
  await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
});

it(
  "converges an authorized idle repository through independent review, exact apply and restart recovery",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const observed: unknown[] = [];
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;
    for (let cycle = 0; cycle < 15; cycle++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `restart-${cycle}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
      observed.push(result);
      if (
        result.status === "processed" &&
        result.convergence.state === "idle" &&
        result.convergence.lastVerifiedCurrency !== null
      )
        break;
    }
    expect(result!, JSON.stringify(observed)).toMatchObject({
      status: "processed",
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    const assignments = await listAssignments(f.root);
    expect(
      assignments.filter((item) => item.convergence?.stage === "normalization_generation"),
    ).toHaveLength(1);
    expect(
      assignments.filter((item) => item.convergence?.stage === "normalization_review"),
    ).toHaveLength(1);
    const agents = await listAgents(f.root);
    expect(
      new Set(agents.filter((item) => item.parentAgentId !== null).map((item) => item.agentId))
        .size,
    ).toBeGreaterThanOrEqual(3);
    const calls = (await readFile(f.log, "utf8")).trim().split("\n");
    // ADR-0536: every provider step runs from the same neutral dispatch cwd, never a checkout.
    expect(new Set(calls.map((line) => JSON.parse(line).cwd))).toEqual(
      new Set([providerCliDispatchContext().cwd]),
    );
    await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "idle",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls.length);
  },
);

it(
  "never emits tracked sensitive contents to the text provider",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(resolve(f.root, ".env"), "PRIVATE_TEST_SECRET=never-pass-to-provider\n");
    execFileSync("git", ["-C", f.root, "add", "-f", ".env"]);
    const result = await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "fixture",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    // The provider must have reviewed the repository's sources; an absent log proves nothing.
    const calls = await readFile(f.log, "utf8");
    expect(
      calls
        .trim()
        .split("\n")
        .some((line) => JSON.parse(line).request.task === "canonical_baseline_assessment"),
    ).toBe(true);
    expect(calls).not.toContain("never-pass-to-provider");
    expect(result.status).toBe("processed");
  },
);

it("applies owner-stated rules only on the convergence owner, and a failure blocks nothing (ADR-0545)", async () => {
  const f = await fixture();
  fixtures.push(f);
  const calls: string[] = [];
  const run = (
    role: "owner" | "waiting_owner" | null,
    apply: () => Promise<unknown> = async () => {
      calls.push(role ?? "single_host");
    },
  ) =>
    runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "fixture",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      applyOwnerStatedInstructions: apply,
      ...(role === null
        ? {}
        : {
            owner: async () =>
              ({
                role,
                reason: role === "owner" ? "lease_granted" : "convergence_owner_elsewhere",
                mode: "hub",
                hostHash: `sha256:${"1".repeat(64)}`,
                hostLabel: "mac",
                holder:
                  role === "owner"
                    ? null
                    : {
                        hostHash: `sha256:${"2".repeat(64)}`,
                        label: "wsl",
                        generation: 3,
                        expiresAt: null,
                      },
                validUntil: role === "owner" ? new Date(Date.now() + 600_000).toISOString() : null,
                wakeAt: null,
                grantedAt: null,
                yieldUntil: null,
                observedAt: new Date().toISOString(),
              }) as never,
          }),
    });
  expect(await run(null)).toMatchObject({ status: "processed" });
  expect(await run("waiting_owner")).toMatchObject({ status: "waiting_owner" });
  expect(calls).toEqual(["single_host"]);
  expect(await run("owner")).toMatchObject({ status: "processed" });
  expect(calls).toEqual(["single_host", "owner"]);
  expect(
    await run(null, async () => {
      throw new Error("apply failed");
    }),
  ).toMatchObject({ status: "processed" });
});

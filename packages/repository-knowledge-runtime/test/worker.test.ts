import { convergenceDelegationPlanHash } from "../src/delegation.js";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listAssignments, listAgents } from "@lervo/agent-workforce";
import { providerCliDispatchContext } from "@lervo/repository-knowledge-compiler";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
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

it.each(["present", "absent"] as const)(
  "integrates a reviewed canonical draft through isolated workspaces and verifies actual repository bytes when the integration ref is %s",
  { timeout: 240_000 },
  async (integrationRef) => {
    const f = await fixture(true, true);
    fixtures.push(f);
    // A delegation seeded on another host names a branch that this host never created.
    if (integrationRef === "absent")
      execFileSync("git", ["-C", f.root, "branch", "-D", "knowledge-integration"]);
    const runtimeSource = resolve(f.root, "src/runtime.ts");
    await writeFile(
      runtimeSource,
      `${await readFile(runtimeSource, "utf8")}// observed source change\n`,
    );
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;
    const states: unknown[] = [];
    for (let cycle = 0; cycle < 24; cycle++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `canonical-${cycle}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
      states.push(result);
      if (
        result.status === "processed" &&
        result.convergence.lastVerifiedCurrency !== null &&
        result.convergence.state === "idle"
      )
        break;
    }
    expect(result!, JSON.stringify(states)).toMatchObject({
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    const actual = await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8");
    expect(actual).toContain("Background model calls are limited to two per host.");
    const integrated = execFileSync(
      "git",
      ["-C", f.root, "show", "refs/heads/knowledge-integration:docs/specs/runtime.md"],
      { encoding: "utf8" },
    );
    expect(integrated).toBe(actual);
    expect(
      f.events
        .list({ limit: 1000 })
        .filter(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.operation === "canonicalize",
        ),
    ).toHaveLength(1);
  },
);

it.each(["source", "delegation"] as const)(
  "cancels an in-flight provider when %s changes and never settles current",
  { timeout: 30_000 },
  async (kind) => {
    const f = await fixture(true);
    fixtures.push(f);
    const script = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      script.replace(
        "if(request.envelope)",
        "await new Promise(resolve=>setTimeout(resolve,5000));\nif(request.envelope)",
      ),
    );
    const running = runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "drift",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      maximumStages: 1,
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(f.log, "utf8").catch(() => "")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (kind === "source")
      await writeFile(
        resolve(f.root, "docs/specs/runtime.md"),
        "# Runtime\n\nThe source changed during review.\n",
      );
    else {
      const { review, ...plan } = f.delegation!;
      const revokedPlan = { ...plan, state: "revoked" as const };
      const delegation = {
        ...revokedPlan,
        review: { ...review, planHash: convergenceDelegationPlanHash(revokedPlan) },
      };
      await writeFile(
        resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
        JSON.stringify(delegation),
      );
    }
    const result = await running;
    expect(result.status).toBe("processed");
    expect(
      f.events
        .list({ limit: 1000 })
        .some(
          (event) =>
            event.type === "repository.knowledge.convergence.recorded" &&
            event.payload.terminalState === "current",
        ),
    ).toBe(false);
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(1);
  },
);

it(
  "parks a source whose draft meets a dirty canonical target and readmits it after the owner commits",
  { timeout: 240_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    const runtimeSource = resolve(f.root, "src/runtime.ts");
    await writeFile(
      runtimeSource,
      `${await readFile(runtimeSource, "utf8")}// observed source change\n`,
    );
    const path = resolve(f.root, "docs/specs/runtime.md");
    const original = await readFile(path, "utf8");
    const dirty = original + "\nPreserve this exact uncommitted user requirement.\n";
    await writeFile(path, dirty);
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "dirty-target",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
    // ADR-0530: the divergent draft parks its source and every later stage still runs.
    let parked: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 12; cycle++) {
      parked = await run();
      if (parked.status === "processed" && parked.convergence.state === "attention_required") break;
    }
    expect(parked!).toMatchObject({
      convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
    });
    expect((await inspectAutonomousKnowledgeStatus(f.storage)).parked).toEqual({
      count: 1,
      sources: [
        { stage: "canonical", path: "src/runtime.ts", reason: "target_diverged", attempts: 1 },
      ],
    });
    // Normalization may still rewrite the pending document, but never drops the owner's requirement.
    expect(await readFile(path, "utf8")).toContain(
      "Preserve this exact uncommitted user requirement.",
    );
    const assignments = await listAssignments(f.root);
    expect(assignments.some((item) => item.convergence?.stage === "canonical_integration")).toBe(
      false,
    );
    const calls = await readFile(f.log, "utf8");
    expect(await run()).toMatchObject({
      convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
    });
    expect(await readFile(f.log, "utf8")).toBe(calls);
    // Committing the owner's requirement changes HEAD's target bytes, which readmits the source.
    execFileSync(
      "git",
      [
        "-C",
        f.root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@lervo.invalid",
        "commit",
        "-qm",
        "Owner requirement",
        "--",
        "docs/specs/runtime.md",
      ],
      { encoding: "utf8" },
    );
    let resumed: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 16; cycle++) {
      resumed = await run();
      if (
        resumed.status === "processed" &&
        resumed.convergence.state === "idle" &&
        resumed.convergence.lastVerifiedCurrency
      )
        break;
    }
    expect(resumed!).toMatchObject({
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    expect(await readFile(path, "utf8")).toContain(
      "Preserve this exact uncommitted user requirement.",
    );
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

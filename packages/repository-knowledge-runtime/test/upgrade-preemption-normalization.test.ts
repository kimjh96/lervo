import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

/** Every normalization generation call the stage asked for, including split retries. */
const normalizationCallAttempts: string[] = [];

vi.mock("../src/provider-call.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/provider-call.js")>();
  return {
    ...actual,
    withKnowledgeProviderAdmission: (
      input: Parameters<typeof actual.withKnowledgeProviderAdmission>[0],
    ) => {
      normalizationCallAttempts.push(input.budget.batchId);
      return actual.withKnowledgeProviderAdmission(input);
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it(
  "settles a normalization generation abandoned for an upgrade as waiting, without splitting the shard (ADR-0587)",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    // A second small document puts two documents in one generation shard.
    await writeFile(
      resolve(f.root, "docs/specs/storage.md"),
      "# Storage\n\nThe runtime keeps durable history in the local event store.\n",
    );
    execFileSync("git", ["-C", f.root, "add", "docs/specs"]);
    execFileSync("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "-m",
      "add storage spec",
    ]);
    // As on WSL lervo: a multi-document generation call runs to a 10-minute timeout.
    const script = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      script.replace(
        "if(request.envelope){response=",
        "if(request.envelope&&request.envelope.documents.length>1)await new Promise(resolveCall=>setTimeout(resolveCall,600000));\nif(request.envelope){response=",
      ),
    );
    const envelopeRequests = () =>
      existsSync(f.log)
        ? readFileSync(f.log, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(
              (line) =>
                (JSON.parse(line) as { request: { envelope?: { documents: unknown[] } } }).request,
            )
            .filter((request) => request.envelope !== undefined)
        : [];
    // The upgrade starts waiting once the multi-document call is running.
    let callStartedAt: number | null = null;
    const upgradeWaiting = async () => {
      if (callStartedAt === null && envelopeRequests().length > 0) callStartedAt = Date.now();
      return callStartedAt !== null;
    };
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>> | undefined;
    for (let cycle = 0; cycle < 30; cycle++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "resident",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        shouldYield: upgradeWaiting,
        yieldToUpgrade: upgradeWaiting,
      });
      if (result.status === "busy") break;
    }
    expect(result).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
    expect(callStartedAt).not.toBeNull();
    // The cycle stopped long before the call's timeout.
    expect(Date.now() - callStartedAt!).toBeLessThan(120_000);
    // One call reached the provider with both documents, and no document-by-document retry ran.
    expect(envelopeRequests()).toHaveLength(1);
    expect(envelopeRequests()[0]!.envelope!.documents).toHaveLength(2);
    expect(normalizationCallAttempts).toHaveLength(1);
    const stages = f.events
      .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
      .map(
        (event) => event.payload as { stage: string; state: string; failureCode: string | null },
      );
    expect(stages).toContainEqual(
      expect.objectContaining({
        stage: "normalization_generation",
        state: "waiting_authority",
        failureCode: "knowledge_capacity_unavailable",
      }),
    );
    expect(stages.some((stage) => stage.failureCode === "normalization_budget_exceeded")).toBe(
      false,
    );
    expect(
      stages.some(
        (stage) =>
          stage.stage === "normalization_generation" && stage.state === "attention_required",
      ),
    ).toBe(false);
  },
);

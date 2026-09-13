import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { expect, it } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import { researchAcceptanceFixture } from "./supervision-research.fixture.js";

const executable = process.env.LERVO_LIVE_SUPERVISION_PROVIDER;
const profile = process.env.LERVO_LIVE_SUPERVISION_PROFILE;
const reportPath = process.env.LERVO_LIVE_RESEARCH_REPORT;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

it.skipIf(executable === undefined || profile === undefined || reportPath === undefined)(
  "accepts sourced research through a real signed-in worker, actual checker and independent owner",
  async () => {
    for (const path of [executable!, profile!, reportPath!]) expect(isAbsolute(path)).toBe(true);
    const roots: string[] = [];
    const f = await researchAcceptanceFixture(roots, 100000);
    const storage = await openProjectStorage(f.root);
    const sourceRevision = (await captureRepositorySnapshot(resolve("."))).revision;
    const bundleHash = digest(await readFile(f.cliBundle));
    const now = () => new Date().toISOString();
    const startedAt = now();
    const cycles: unknown[] = [];
    const attention: unknown[] = [];
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ownerReasoning: { provider: "codex", reservedTokens: 100000 },
      managedExecution: { nodeExecutable: process.execPath, cliBundle: f.cliBundle },
      runtimeReadiness: {
        ...f.runtimeReadiness,
        providerExecutables: { codex: executable! },
        providerLoginContexts: {
          codex: { homeDirectory: homedir(), configurationDirectory: profile! },
        },
      },
      ports: {
        now,
        recordAttention: async (report, reasons) => {
          attention.push({ report, reasons });
        },
      },
    });
    let failure: string | null = null;
    try {
      for (let index = 0; index < 3; index++) {
        const cycle = await runtime.runCycle();
        cycles.push(cycle);
        expect(cycle.disposition, JSON.stringify({ cycles, attention })).toBe("effect_confirmed");
      }
      expect(await listAssignments(f.root)).toMatchObject([
        { status: "completed", roleId: "researcher" },
      ]);
      const events = storage.events.list({ limit: 1000 });
      expect(events.filter((event) => event.type === "role.input.bound")).toHaveLength(1);
      const decisions = await Promise.all(
        events
          .filter((event) => event.type === "work.supervision.decision.recorded")
          .map((event) =>
            readSupervisionJsonArtifact(storage.artifacts, String(event.payload.planHash)),
          ),
      );
      const plan = decisions.find(
        (item) =>
          (item as { effectContract: string }).effectContract === "work.assignment_completion.v2",
      ) as { effectHash: string };
      expect(plan).toBeDefined();
      const effect = (await readSupervisionJsonArtifact(storage.artifacts, plan.effectHash)) as {
        roleEvaluationArtifactHash: string;
      };
      const evaluation = (await readSupervisionJsonArtifact(
        storage.artifacts,
        effect.roleEvaluationArtifactHash,
      )) as {
        overallStatus: string;
        producerRunId: string;
        checks: { method: string; evaluatorRunId: string | null }[];
      };
      expect(evaluation.overallStatus).toBe("passed");
      for (const check of evaluation.checks.filter((item) => item.method === "separate_semantic"))
        expect(check.evaluatorRunId).not.toBe(evaluation.producerRunId);
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
      expect(digest(await readFile(f.cliBundle))).toBe(bundleHash);
    } catch (error) {
      failure = error instanceof Error ? error.message : "live_research_failed";
      throw error;
    } finally {
      await runtime.close();
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      await writeFile(
        reportPath!,
        JSON.stringify(
          {
            schemaVersion: 1,
            startedAt,
            completedAt: now(),
            sourceRevision,
            cliBundleHash: bundleHash,
            repositoryRoot: f.root,
            retainedRoots: roots,
            binding: f.binding,
            roleContractHash: f.task.roleContractHash,
            cycles,
            attention,
            failure,
            providerStarts: source.events.filter((event) => event.type === "adapter.started")
              .length,
            resources: source.workstreamResources,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await storage.close();
    }
  },
  900000,
);

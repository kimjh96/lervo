import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "../src/supervision-artifact-json.js";
import { liveSupervisionFixture } from "./supervision-live.fixture.js";
import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";

const executable = process.env.LERVO_LIVE_SUPERVISION_PROVIDER;
const profile = process.env.LERVO_LIVE_SUPERVISION_PROFILE;
const reportPath = process.env.LERVO_LIVE_SUPERVISION_REPORT;

it.skipIf(executable === undefined || profile === undefined || reportPath === undefined)(
  "completes a local goal through real signed-in owner and worker calls with actual verification",
  async () => {
    for (const path of [executable!, profile!, reportPath!]) expect(isAbsolute(path)).toBe(true);
    const f = await liveSupervisionFixture(executable!, profile!);
    const storage = await openProjectStorage(f.root);
    const cycles: unknown[] = [],
      attention: unknown[] = [];
    const now = () => new Date().toISOString();
    const startedAt = now();
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ownerReasoning: { provider: "codex", reservedTokens: 100000 },
      managedExecution: {
        nodeExecutable: process.execPath,
        cliBundle: resolve("apps/cli/dist/bin.js"),
      },
      runtimeReadiness: f.configuration,
      ports: {
        now,
        recordAttention: async (report, reasons) => {
          attention.push({ report, reasons });
        },
      },
    });
    let failure: string | null = null;
    try {
      for (let cycle = 0; cycle < 20; cycle++) {
        const result = await runtime.runCycle();
        cycles.push(result);
        if ((await readCurrentWorkstreamState(f.root))!.snapshot.status === "completed") break;
        expect(
          ["blocked", "uncertain", "busy", "idle"].includes(result.disposition),
          JSON.stringify({ result, attention }),
        ).toBe(false);
      }
      expect((await readCurrentWorkstreamState(f.root))!.snapshot.status).toBe("completed");
      for (let i = 0; i < 2; i++) {
        const idle = await runtime.runCycle();
        cycles.push(idle);
        expect(idle.disposition).toBe("idle");
      }
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      const completed = source.events.findLast(
        (event) =>
          event.type === "work.supervision.decision.recorded" &&
          event.payload.actionKind === "execute_as_owner",
      );
      expect(completed).toBeDefined();
      const plan = (await readSupervisionJsonArtifact(
        storage.artifacts,
        String(completed!.payload.planArtifactHash),
      )) as OperatingActionPlanV1;
      const effect = (await readSupervisionJsonArtifact(
        storage.artifacts,
        plan.effectHash,
      )) as SupervisedGoalCompletionV1;
      expect(effect.kind).toBe("work.goal_completion");
      const answer = await readSupervisionTextArtifact(
        storage.artifacts,
        effect.resultArtifactHash,
      );
      expect(answer).toMatch(/saved/iu);
      expect(answer).toMatch(/true/iu);
      expect(source.assignments).toHaveLength(1);
      expect(source.assignments[0]!.status).toBe("completed");
      expect(source.workstreamResources.groups).toMatchObject([
        { completeness: "complete", source: "provider_reported" },
      ]);
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : "live_acceptance_failed";
      throw error;
    } finally {
      await runtime.close();
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      const report = {
        schemaVersion: 1,
        startedAt,
        completedAt: now(),
        provider: "codex",
        modelOutcomes: "external_native_provider",
        repositoryRoot: f.root,
        retainedRoots: f.roots,
        binding: f.binding,
        cliBundleHash: `sha256:${createHash("sha256")
          .update(await readFile(resolve("apps/cli/dist/bin.js")))
          .digest("hex")}`,
        cycles,
        attention,
        failure,
        workstreamHash: source.workstreamHash,
        providerStarts: source.events.filter((event) => event.type === "adapter.started").length,
        resources: source.workstreamResources,
      };
      await writeFile(reportPath!, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
      await storage.close();
    }
  },
  900000,
);

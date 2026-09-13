import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { liveSupervisionFixture } from "./supervision-live.fixture.js";
import { openNodeSupervisionService } from "../src/supervision-startup.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import type { NodeRuntimeComponentHealth } from "../src/health-contract.js";

const executable = process.env.LERVO_LIVE_SUPERVISION_PROVIDER;
const profile = process.env.LERVO_LIVE_SUPERVISION_PROFILE;
const reportPath = process.env.LERVO_LIVE_SERVICE_REPORT;

it.skipIf(executable === undefined || profile === undefined || reportPath === undefined)(
  "finishes a real goal through the background service and stays idle after restart without a Hub",
  async () => {
    for (const path of [executable!, profile!, reportPath!]) expect(isAbsolute(path)).toBe(true);
    const f = await liveSupervisionFixture(executable!, profile!);
    const storage = await openProjectStorage(f.root);
    const health: NodeRuntimeComponentHealth[] = [];
    const now = () => new Date().toISOString();
    const startedAt = now();
    const cliBundle = resolve("apps/cli/dist/bin.js");
    const bundleHash = async () =>
      `sha256:${createHash("sha256")
        .update(await readFile(cliBundle))
        .digest("hex")}`;
    const initialBundleHash = await bundleHash();
    const configuration = {
      binding: f.binding,
      runtimeReadiness: f.configuration,
      ownerReasoning: { provider: "codex" as const, reservedTokens: 100000 },
      managedExecution: { nodeExecutable: process.execPath, cliBundle },
    };
    const open = () =>
      openNodeSupervisionService({
        repositoryRoot: f.root,
        configuration,
        observeHealth: async (observation) => {
          health.push(observation);
        },
      });
    let service = await open();
    let failure: string | null = null;
    let idleEventCount: number | null = null;
    try {
      service.start();
      await Promise.race([
        vi.waitFor(
          async () => {
            expect((await readCurrentWorkstreamState(f.root))!.snapshot.status).toBe("completed");
          },
          { timeout: 600000, interval: 1000 },
        ),
        service.failed.then(() => {
          throw new Error("The background service failed before goal completion.");
        }),
      ]);
      await service.close();
      const before = await new SupervisionTaskSource(storage, f.binding, now).read();
      expect(before.assignments).toHaveLength(1);
      expect(before.assignments[0]!.status).toBe("completed");
      expect(before.workstreamResources.groups).toMatchObject([
        { completeness: "complete", source: "provider_reported" },
      ]);
      expect(health.some((observation) => observation.status === "ready")).toBe(true);
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
      service = await open();
      service.start();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await service.close();
      const after = await new SupervisionTaskSource(storage, f.binding, now).read();
      expect(after.events.map((event) => event.eventId)).toEqual(
        before.events.map((event) => event.eventId),
      );
      idleEventCount = after.events.length;
      expect(await bundleHash()).toBe(initialBundleHash);
    } catch (error) {
      failure = error instanceof Error ? error.message : "live_service_acceptance_failed";
      throw error;
    } finally {
      await service.close();
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      await writeFile(
        reportPath!,
        JSON.stringify(
          {
            schemaVersion: 1,
            startedAt,
            completedAt: now(),
            repositoryRoot: f.root,
            retainedRoots: f.roots,
            binding: f.binding,
            cliBundleHash: initialBundleHash,
            modelOutcomes: "external_native_provider",
            scheduling: "background_service",
            hubConfigured: false,
            failure,
            health,
            idleEventCount,
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
  660000,
);

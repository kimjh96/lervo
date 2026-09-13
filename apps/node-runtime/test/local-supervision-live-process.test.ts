import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { liveSupervisionFixture } from "./supervision-live.fixture.js";
import { loadLocalSupervisionConfig } from "../src/local-supervision-config.js";

const executable = process.env.LERVO_LIVE_SUPERVISION_PROVIDER;
const profile = process.env.LERVO_LIVE_SUPERVISION_PROFILE;
const reportPath = process.env.LERVO_LIVE_LOCAL_PROCESS_REPORT;
const bundle = process.env.LERVO_LIVE_NODE_BUNDLE;
const cliBundle = process.env.LERVO_LIVE_CLI_BUNDLE;
const resumeConfig = process.env.LERVO_LIVE_LOCAL_PROCESS_RESUME_CONFIG;

it.skipIf(
  [executable, profile, reportPath, bundle, cliBundle].some((value) => value === undefined),
)(
  "completes a source observation through the installed local command and restarts without duplicate work",
  async () => {
    for (const path of [executable!, profile!, reportPath!, bundle!, cliBundle!])
      expect(isAbsolute(path)).toBe(true);
    const retained =
      resumeConfig === undefined ? null : await loadLocalSupervisionConfig(resumeConfig);
    const f =
      retained === null
        ? await liveSupervisionFixture(executable!, profile!)
        : {
            root: retained.repositoryRoot,
            roots: [
              retained.repositoryRoot,
              retained.configuration.runtimeReadiness.workerWorkspace!.parentDirectory,
            ],
            binding: retained.configuration.binding,
            configuration: retained.configuration.runtimeReadiness,
          };
    const configPath = resolve(
      f.configuration.workerWorkspace!.parentDirectory,
      "local-supervision.json",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: f.root,
        outcomeSupervision: {
          binding: f.binding,
          runtimeReadiness: f.configuration,
          ownerReasoning: retained?.configuration.ownerReasoning ?? {
            provider: "codex",
            reservedTokens: 100000,
          },
          managedExecution: { nodeExecutable: process.execPath, cliBundle: cliBundle! },
        },
      }),
      { mode: 0o600 },
    );
    const hash = async (path: string) =>
      `sha256:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`;
    const binaries = { node: await hash(bundle!), cli: await hash(cliBundle!) };
    const startedAt = new Date().toISOString();
    const children: { child: ChildProcess; exited: Promise<number | null> }[] = [];
    const health: { status: string; failureCode?: string }[] = [];
    const errors: string[] = [];
    const start = () => {
      const child = spawn(process.execPath, [bundle!, "supervise", "--config", configPath], {
        cwd: f.root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let pending = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        pending += chunk;
        if (pending.length > 65536) {
          errors.push("stdout_limit");
          child.kill("SIGTERM");
          return;
        }
        while (pending.includes("\n")) {
          const end = pending.indexOf("\n");
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            health.push(JSON.parse(line));
          } catch {
            errors.push("invalid_health_output");
          }
        }
      });
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => {
        if (errors.join("").length < 65536) errors.push(chunk);
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      const entry = { child, exited };
      children.push(entry);
      return entry;
    };
    const stop = async (process: (typeof children)[number]) => {
      if (process.child.exitCode === null && process.child.signalCode === null)
        process.child.kill("SIGTERM");
      return process.exited;
    };
    const storage = await openProjectStorage(f.root);
    let failure: string | null = null;
    let idleEventCount: number | null = null;
    try {
      const first = start();
      const deadline = Date.now() + 600000;
      while ((await readCurrentWorkstreamState(f.root))!.snapshot.status !== "completed") {
        expect(first.child.exitCode, errors.join("")).toBeNull();
        expect(first.child.signalCode).toBeNull();
        expect(
          health.find((observation) => observation.status === "unavailable"),
          "The installed service requires reconciliation.",
        ).toBeUndefined();
        expect(Date.now(), "The installed goal exceeded its observation window.").toBeLessThan(
          deadline,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(await stop(first)).toBe(0);
      const before = await new SupervisionTaskSource(storage, f.binding, () =>
        new Date().toISOString(),
      ).read();
      expect(before.assignments).toHaveLength(1);
      expect(before.assignments[0]!.status).toBe("completed");
      expect(before.workstreamResources.groups.length).toBeGreaterThan(0);
      expect(
        before.workstreamResources.groups.every((group) => group.completeness === "complete"),
      ).toBe(true);
      expect(health).toContainEqual({
        schemaVersion: 1,
        component: "supervision",
        status: "ready",
      });
      const healthCount = health.length;
      const second = start();
      await vi.waitFor(() => expect(health.length).toBeGreaterThan(healthCount), {
        timeout: 30000,
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await stop(second)).toBe(0);
      const after = await new SupervisionTaskSource(storage, f.binding, () =>
        new Date().toISOString(),
      ).read();
      expect(after.events.map((event) => event.eventId)).toEqual(
        before.events.map((event) => event.eventId),
      );
      idleEventCount = after.events.length;
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
      expect({ node: await hash(bundle!), cli: await hash(cliBundle!) }).toEqual(binaries);
    } catch (error) {
      failure = error instanceof Error ? error.message : "installed_local_acceptance_failed";
      throw error;
    } finally {
      await Promise.all(children.map(stop));
      const source = await new SupervisionTaskSource(storage, f.binding, () =>
        new Date().toISOString(),
      ).read();
      await writeFile(
        reportPath!,
        JSON.stringify(
          {
            schemaVersion: 1,
            startedAt,
            completedAt: new Date().toISOString(),
            repositoryRoot: f.root,
            retainedRoots: f.roots,
            resumedExistingAuthority: retained !== null,
            binding: f.binding,
            binaries,
            intake: "local_command",
            modelOutcomes: "external_native_provider",
            hubConfigured: false,
            processIds: children.map(({ child }) => child.pid),
            health,
            failure,
            idleEventCount,
            providerStarts: source.events.filter((event) => event.type === "adapter.started")
              .length,
            resources: source.workstreamResources,
            diagnosticErrors: errors,
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

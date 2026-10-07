import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./fixture.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it(
  "retains owned uncertainty after process death between canonical file apply and evidence append",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 2; // observed runtime limit\n",
    );
    const repository = resolve(".");
    const child = resolve(f.directory, "crash-worker.mjs");
    await writeFile(
      child,
      `
import { SQLiteEventStore } from ${JSON.stringify(resolve(repository, "packages/event-store-sqlite/dist/index.js"))};
import { FileSystemCas } from ${JSON.stringify(resolve(repository, "packages/cas/dist/index.js"))};
import { loadProjectManifest, resolveProjectPaths } from ${JSON.stringify(resolve(repository, "packages/project/dist/index.js"))};
import { runAutonomousKnowledgeWorker } from ${JSON.stringify(resolve(repository, "packages/repository-knowledge-runtime/dist/index.js"))};
const root = ${JSON.stringify(f.root)};
const manifest = await loadProjectManifest(root);
const paths = resolveProjectPaths(root);
const events = await SQLiteEventStore.open({path: paths.eventDatabase, projectId: manifest.projectId, writableEventSchemaVersion: 4});
const artifacts = await FileSystemCas.open(paths.cas);
const append = events.append.bind(events);
events.append = (event) => {
  if (event.type === "knowledge.materialization.applied" && event.payload.operation === "canonicalize") process.kill(process.pid, "SIGKILL");
  return append(event);
};
await runAutonomousKnowledgeWorker({storage: {manifest, paths, events, artifacts, writableEventSchemaVersion: 4, close: async () => events.close()}, workerId: "crashed", provider: "claude", executable: ${JSON.stringify(f.executable)}, admissionDirectory: ${JSON.stringify(f.admissionDirectory)}});
throw new Error("The intended crash boundary was not reached.");
`,
    );
    await expect(
      promisify(execFile)(process.execPath, [child], { timeout: 110_000 }),
    ).rejects.toMatchObject({ signal: "SIGKILL" });
    expect(await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8")).toContain(
      "limited to two",
    );
    const calls = (await readFile(f.log, "utf8")).trim().split("\n").length;
    expect(calls).toBeGreaterThan(0);
    const result = await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "restarted",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    expect(result).toMatchObject({
      status: "processed",
      convergence: {
        state: "recovery_required",
        reason: "knowledge_recovery_required",
        debtCounts: null,
        lastVerifiedCurrency: null,
      },
    });
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls);
    expect(
      f.events
        .list({ limit: 1000 })
        .some(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.operation === "canonicalize",
        ),
    ).toBe(false);
    expect(
      f.events
        .list({ limit: 1000 })
        .some(
          (event) =>
            event.type === "repository.knowledge.convergence.recorded" &&
            event.payload.terminalState === "current",
        ),
    ).toBe(false);
  },
);

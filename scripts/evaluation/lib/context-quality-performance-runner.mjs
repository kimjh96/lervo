import { qualify } from "./context-quality-performance-report.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { cpus, totalmem, tmpdir, loadavg } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../..");
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function buildHash() {
  const entries = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.name.endsWith(".js"))
        entries.push([child.slice(repository.length + 1), hash(await readFile(child))]);
    }
  }
  for (const entry of await readdir(resolve(repository, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await visit(resolve(repository, "packages", entry.name, "dist"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return hash(JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0]))));
}

function hostObservation() {
  return {
    observedAt: new Date().toISOString(),
    loadAverage: loadavg(),
    cpuTimes: cpus().map((cpu) => cpu.times),
  };
}
export async function run(protocolPath, script) {
  const protocolBytes = await readFile(resolve(repository, protocolPath));
  const protocol = JSON.parse(protocolBytes);
  const { applyInitPlan, createInitPlan } = await import("../../../packages/project/dist/index.js");
  const results = [];
  const artifactBuildHash = await buildHash();
  if (
    protocol.expectedArtifactBuildHash &&
    protocol.expectedArtifactBuildHash !== artifactBuildHash
  ) {
    throw new Error("Expected artifact build differs; no cohort started");
  }
  const harnessHashes = await Promise.all(
    [
      script,
      resolve(import.meta.dirname, "context-quality-performance-runner.mjs"),
      resolve(import.meta.dirname, "context-quality-performance-worker.mjs"),
      resolve(import.meta.dirname, "context-quality-performance-report.mjs"),
    ].map(async (path) => [path.slice(repository.length + 1), hash(await readFile(path))]),
  );
  const phaseProbes = [];
  const measurementStartedAt = new Date().toISOString();
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-performance-"));
  try {
    await writeFile(
      resolve(root, "README.md"),
      `# Runtime\n## Background\n${"noise ".repeat(5300)}\n## Cancellation\nKeep other waiters alive.\n## Exceptions\nDo not reuse stale sources.\n`,
    );
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_qualityperf" }));
    await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
    await writeFile(
      resolve(root, `docs/instructions/generated/rule_${"a".repeat(24)}.md`),
      "# Rule\nPreserve exact source hashes.\n",
    );
    for (const lifecycle of ["warm", "cold"]) {
      const count = lifecycle === "warm" ? protocol.warmPairs : protocol.coldPairs;
      for (let pair = 0; pair < count; pair++) {
        for (const arm of pair % 2 ? ["candidate", "control"] : ["control", "candidate"]) {
          const hostBefore = hostObservation();
          const start = performance.now();
          try {
            const { stdout } = await execFileAsync(
              process.execPath,
              [script, "--worker", root, arm, lifecycle, JSON.stringify(protocol)],
              { timeout: protocol.costCeilings.processDeadlineMs, maxBuffer: 1024 * 1024 },
            );
            results.push({
              lifecycle,
              pair,
              arm,
              processMs: performance.now() - start,
              hostBefore,
              hostAfter: hostObservation(),
              status: "completed",
              ...JSON.parse(stdout),
            });
          } catch (error) {
            results.push({
              lifecycle,
              pair,
              arm,
              processMs: performance.now() - start,
              hostBefore,
              hostAfter: hostObservation(),
              status: "failed",
              reason: error.killed ? "deadline" : "process_failed",
            });
          }
        }
      }
    }
    for (let probe = 0; probe < (protocol.phaseProbeProcesses ?? 0); probe++) {
      try {
        const { stdout } = await execFileAsync(
          process.execPath,
          [script, "--worker", root, "probe", "cold", JSON.stringify(protocol)],
          { timeout: protocol.costCeilings.processDeadlineMs, maxBuffer: 1024 * 1024 },
        );
        phaseProbes.push({ probe, status: "completed", ...JSON.parse(stdout) });
      } catch (error) {
        phaseProbes.push({
          probe,
          status: "failed",
          reason: error.killed ? "deadline" : "process_failed",
        });
      }
    }
    const qualification = qualify(results, protocol, artifactBuildHash, await buildHash());
    return {
      protocol,
      protocolHash: hash(protocolBytes),
      artifactBuildHash,
      ...qualification,
      diagnosticComplete:
        qualification.complete &&
        phaseProbes.length === (protocol.phaseProbeProcesses ?? 0) &&
        phaseProbes.every(
          (probe) =>
            probe.status === "completed" &&
            probe.selectedWriter === 1 &&
            [probe.preparationMs, probe.reportCloneMs, probe.writerCoordinateMs].every(
              (ms) => Number.isFinite(ms) && ms >= 0,
            ),
        ),
      harnessHashes,
      measurementStartedAt,
      phaseProbes,
      measurementConditions:
        protocol.measurementConditions ??
        "Shared developer workstation; operating-system caches and background workloads are not isolated",
      observedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpuModel: cpus()[0]?.model ?? null,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      results,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

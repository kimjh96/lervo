import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, loadavg, tmpdir, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { initializeActiveFixture } from "./context-quality-active-fixture.mjs";
import { artifactBuildHash, digest } from "./context-quality-artifact-identity.mjs";
import { qualifyActive } from "./context-quality-active-report.mjs";
import { sampleColumns } from "./context-quality-active-worker.mjs";
const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../..");
const host = () => ({
  at: new Date().toISOString(),
  load: loadavg(),
  cpuTimes: cpus().map(({ times }) => [times.user, times.nice, times.sys, times.idle, times.irq]),
});

export function validateActiveProtocol(p) {
  if (
    p.schemaVersion !== 1 ||
    ![
      "context-quality-active-resource-v1",
      "context-quality-recording-repair-v1",
      "context-quality-recording-repair-v2",
      "context-quality-recording-repair-v3",
      "context-quality-recording-repair-v4",
      "context-quality-recording-repair-v5",
      "context-quality-recording-repair-v6",
      "context-quality-recording-repair-v7",
      "context-quality-recording-repair-v8",
      "context-quality-recording-repair-v9",
      "context-quality-recording-repair-v10",
      "context-quality-recording-repair-v11",
      "context-quality-recording-repair-v12",
      "context-quality-native-source-v1",
    ].includes(p.protocolId) ||
    JSON.stringify(p.profiles) !== "[4096,12288]" ||
    JSON.stringify(p.pairs) !== '{"warm":30,"cold":5,"changed":30,"concurrent":30}' ||
    p.warmups !== 2 ||
    p.samples !== 5 ||
    p.concurrency !== 4 ||
    p.maximumProviderCalls !== 0 ||
    p.processDeadlineMs !== 30000 ||
    p.gates?.meanAddedMsUpper95 !== 10 ||
    p.gates?.processRatioUpper95 !== 1.2 ||
    p.gates?.rssRatioUpper95 !== 1.25 ||
    p.gates?.cpuRatioUpper95 !== 1.25 ||
    p.gates?.maximumStateBytesPerRequest !== 131072 ||
    !/^sha256:[a-f0-9]{64}$/u.test(p.expectedArtifactBuildHash) ||
    !Number.isFinite(Date.parse(p.registeredAt))
  )
    throw new Error("Invalid or weakened active-resource protocol.");
}

export async function runActive(protocolPath, script) {
  const bytes = await readFile(resolve(repository, protocolPath)),
    protocol = JSON.parse(bytes);
  validateActiveProtocol(protocol);
  const build = await artifactBuildHash(repository);
  if (build !== protocol.expectedArtifactBuildHash)
    throw new Error("Build drift; no cohort started.");
  const harnessFiles = [
    script,
    resolve(import.meta.dirname, "context-quality-artifact-identity.mjs"),
    ...["fixture", "worker", "report", "runner"].map((part) =>
      resolve(import.meta.dirname, `context-quality-active-${part}.mjs`),
    ),
    resolve(import.meta.dirname, "context-quality-performance-report.mjs"),
  ];
  const harnessHashes = await Promise.all(
    harnessFiles.map(async (path) => [
      path.slice(repository.length + 1),
      digest(await readFile(path)),
    ]),
  );
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-active-resource-"));
  const root = resolve(parent, "repository"),
    baseline = resolve(parent, "baseline");
  const rows = [],
    startedAt = new Date().toISOString();
  try {
    for (const profile of protocol.profiles)
      for (const [workload, count] of Object.entries(protocol.pairs)) {
        for (let pair = 0; pair < count; pair++) {
          await rm(root, { recursive: true, force: true });
          await rm(baseline, { recursive: true, force: true });
          await initializeActiveFixture(root);
          await cp(root, baseline, { recursive: true });
          for (const arm of pair % 2 ? ["candidate", "control"] : ["control", "candidate"]) {
            await rm(root, { recursive: true, force: true });
            await cp(baseline, root, { recursive: true });
            const before = host(),
              start = performance.now();
            try {
              const { stdout } = await exec(
                process.execPath,
                [
                  script,
                  "--worker",
                  root,
                  arm,
                  workload,
                  String(profile),
                  JSON.stringify(protocol),
                ],
                { timeout: protocol.processDeadlineMs, maxBuffer: 1048576 },
              );
              rows.push({
                profile,
                workload,
                pair,
                arm,
                status: "completed",
                processMs: performance.now() - start,
                hostBefore: before,
                hostAfter: host(),
                ...JSON.parse(stdout),
              });
            } catch (error) {
              rows.push({
                profile,
                workload,
                pair,
                arm,
                status: "failed",
                reason: error.killed ? "deadline" : "process_failed",
                processMs: performance.now() - start,
                hostBefore: before,
                hostAfter: host(),
              });
            }
          }
        }
        process.stderr.write(
          `Completed profile ${profile}, workload ${workload}, ${count} pairs.\n`,
        );
      }
    const finalBuild = await artifactBuildHash(repository);
    return {
      schemaVersion: 1,
      protocol,
      protocolHash: digest(bytes),
      artifactBuildHash: build,
      harnessHashes,
      startedAt,
      completedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        cpuModel: cpus()[0]?.model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      encoding: {
        sampleColumns,
        cpuTimesColumns: ["user", "nice", "sys", "idle", "irq"],
        memoryUnits: "bytes",
        maxRSSUnits: "KiB (Node resourceUsage)",
        warmupsRetainedSeparately: true,
      },
      qualification: qualifyActive(rows, protocol, build === finalBuild),
      rows,
    };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

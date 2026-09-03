import { writeFile } from "node:fs/promises";
import { platform, arch } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { runPairedExecutionPerformanceBenchmark } from "../../packages/execution-performance/dist/index.js";
import { executionEnvironmentProfileHash } from "../../packages/execution-contract/dist/index.js";
import { sha256 } from "../../packages/repository-knowledge/dist/index.js";

import {
  createTerminalPerformanceFixture,
  terminalFixtureProfileSizes,
} from "./performance/terminal-fixture.mjs";
import { foundationPerformanceSourceRevision } from "./performance/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const terminalBuildDigest = sha256("lervo.terminal.unmanaged-observation.v1");

function environment(repositoryProfile, cacheState, concurrency) {
  const sourceCount = terminalFixtureProfileSizes[repositoryProfile] + 2;
  return {
    kind: "execution_environment_profile",
    schemaVersion: 1,
    profileSource: "benchmark_declared",
    lervoBuildDigest: terminalBuildDigest,
    adapterId: null,
    adapterVersion: null,
    provider: null,
    operatingSystem: platform(),
    architecture: arch(),
    nodeVersion: process.version,
    repositoryProfile,
    repositoryDocumentCount: sourceCount,
    repositoryByteCount: null,
    cacheState,
    concurrency,
  };
}

function profile(profileId, repositoryProfile, cacheState, concurrency, hookEvent) {
  const declared = environment(repositoryProfile, cacheState, concurrency);
  return {
    profileId,
    environment: declared,
    environmentProfileDigest: executionEnvironmentProfileHash(declared),
    repositoryProfile,
    cacheState,
    concurrency,
    hookEvent,
    observationUnit: concurrency === 1 ? "hook_invocation" : "concurrent_batch",
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      repetitions: { type: "string", default: "100" },
      profile: { type: "string" },
      write: { type: "string" },
      summary: { type: "boolean" },
    },
  });
  const repetitions = Number(parsed.values.repetitions);
  const declaredProfiles = [
    profile("pf_small_cold_prompt", "small", "cold", 1, "UserPromptSubmit"),
    profile("pf_small_warm_prompt", "small", "warm", 1, "UserPromptSubmit"),
    profile("pf_medium_warm_prompt", "medium", "warm", 1, "UserPromptSubmit"),
    profile("pf_large_warm_prompt", "large", "warm", 1, "UserPromptSubmit"),
    profile("pf_small_warm_stop", "small", "warm", 1, "Stop"),
    profile("pf_medium_warm_prompt_concurrent", "medium", "warm", 4, "UserPromptSubmit"),
  ];
  const profiles =
    parsed.values.profile === undefined
      ? declaredProfiles
      : declaredProfiles.filter((item) => item.profileId === parsed.values.profile);
  if (profiles.length === 0) throw new TypeError("The requested benchmark profile is absent.");
  const fixture = await createTerminalPerformanceFixture(profiles);
  try {
    for (const item of profiles) {
      const template = fixture.templates.get(item.repositoryProfile);
      item.environment.repositoryDocumentCount = template.repositoryDocumentCount;
      item.environment.repositoryByteCount = template.repositoryByteCount;
      item.environmentProfileDigest = executionEnvironmentProfileHash(item.environment);
    }
    const report = await runPairedExecutionPerformanceBenchmark({
      repositoryRevision: await foundationPerformanceSourceRevision(repositoryRoot),
      repetitions,
      profiles,
      ports: fixture,
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (parsed.values.write) await writeFile(resolve(repositoryRoot, parsed.values.write), output);
    process.stdout.write(
      parsed.values.summary
        ? `${JSON.stringify({ reportId: report.reportId, allProfilesPassed: report.allProfilesPassed, profiles: report.profiles.map((item) => ({ profileId: item.profile.profileId, budgetStatus: item.budgetStatus, candidateP95: item.candidate.durationMs.p95, failureReasons: item.failureReasons })) }, null, 2)}\n`
        : output,
    );
    process.exitCode = report.allProfilesPassed ? 0 : 1;
  } finally {
    await fixture.close();
  }
}

await main();

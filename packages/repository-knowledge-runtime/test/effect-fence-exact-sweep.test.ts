import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assessCanonicalization, sha256 } from "@lervo/repository-knowledge";

import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { sweepSourceFences } from "./effect-fence-sweep.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** Exact fences a full convergence of a reviewed canonical draft reaches, by file and count. */
const FULL_CONVERGENCE_FENCES: Record<string, number> = {
  "host.ts": 1,
  "settled-output-boundary.ts": 1,
  "lifecycle-prefix.ts": 1,
  "canonical-target-preflight.ts": 1,
  // Seal and its application, candidate and completion, apply and asset settlement.
  "canonical-workspace.ts": 2,
  "canonical-integration-candidate.ts": 2,
  "canonical-integration-effect.ts": 1,
  "normalization-generation.ts": 1,
  "normalization-apply-stage.ts": 1,
  "lifecycle-final.ts": 2,
  "stage-verification.ts": 1,
};

const fenceCoverage = (sites: Iterable<string>) => {
  const counts: Record<string, number> = {};
  for (const site of sites) counts[site.split(":")[0]!] = (counts[site.split(":")[0]!] ?? 0) + 1;
  return counts;
};

it(
  "refuses every effect of a full convergence when only exact fences observe the repository",
  { timeout: 1_800_000 },
  async () => {
    const sites = new Set<string>();
    const covered = () =>
      Object.entries(FULL_CONVERGENCE_FENCES).every(
        ([file, count]) => (fenceCoverage(sites)[file] ?? 0) >= count,
      );
    // A refused integration can park the draft instead of applying it, so later rounds inject only
    // at fences that earlier rounds never reached.
    for (let round = 0; round < 4 && !covered(); round++) {
      const f = await fixture(true, true);
      fixtures.push(f);
      await writeFile(
        resolve(f.root, "src/runtime.ts"),
        "export const maximumBackgroundCalls = 3;\n",
      );
      const before = git(f.root, "rev-parse", "HEAD");
      const result = await sweepSourceFences({
        f,
        mutatedPath: "src/runtime.ts",
        cycles: 60,
        at: "exact",
        inject: (site) => !sites.has(site),
        done: async () =>
          git(f.root, "rev-parse", "HEAD") !== before &&
          (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent,
      });
      expect(result.violations).toEqual([]);
      for (const site of result.injected) sites.add(site);
    }
    expect(fenceCoverage(sites)).toEqual(FULL_CONVERGENCE_FENCES);
  },
);

it(
  "refuses the reviewed candidate transition when only exact fences observe the repository",
  { timeout: 900_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(resolve(f.root, "src.ts"), "export const localRuntime = true;\n");
    const assessment = await assessCanonicalization({
      repositoryRoot: f.root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {},
      afterFiles: { "src.ts": sha256("export const localRuntime = true;\n") },
      disposition: "canonical_sources_current",
      now: new Date(),
    });
    expect(assessment.candidate).not.toBeNull();
    const result = await sweepSourceFences({
      f,
      mutatedPath: "src.ts",
      cycles: 40,
      at: "exact",
      inject: () => true,
      done: async () => (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent,
    });
    expect(result.violations).toEqual([]);
    expect(result.injected.some((site) => site.startsWith("candidate-resolution.ts"))).toBe(true);
  },
);

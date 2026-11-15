import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { sweepSourceFences } from "./effect-fence-sweep.js";
import { fixture } from "./fixture.js";

// Every refusal is recorded where it is raised, so the sweep can tell which fence refused.
vi.mock("../src/failure.js", async (load) =>
  (await import("./fence-refusal-recorder.js")).recordingFailureModule(
    await load<typeof import("../src/failure.js")>(),
  ),
);

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

it(
  "refuses every effect after an edit that decision checks wrongly called unchanged",
  { timeout: 1_800_000 },
  async () => {
    const sites = new Set<string>();
    const seen = new Set<string>();
    const unfenced = new Set<string>();
    // Each round edits at decision sites no earlier round edited, until none is left.
    for (let round = 0; round < 6; round++) {
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
        at: "decision",
        inject: (site) => !sites.has(site),
        done: async () =>
          git(f.root, "rev-parse", "HEAD") !== before &&
          (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent,
      });
      expect(result.violations).toEqual([]);
      for (const site of result.unfenced) unfenced.add(site);
      for (const site of result.injected) sites.add(site);
      for (const site of result.trace.currentSites) seen.add(site);
      if ([...seen].every((site) => sites.has(site))) break;
    }
    expect([...seen].filter((site) => !sites.has(site))).toEqual([]);
    // The lifecycle currency pair's second check may let a stage reach a waiting or attention
    // record with no further fence; the sweep proved it wrote nothing durable and no current claim.
    expect([...unfenced].filter((site) => !site.startsWith("lifecycle-final.ts:"))).toEqual([]);
  },
);

import { execFile } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
} from "../src/delegation-plan.js";
import { convergenceDelegationPlanHash, loadConvergenceDelegation } from "../src/delegation.js";
import { missingLifecyclePaths } from "../src/lifecycle-plan-scope.js";
import { fixture } from "./fixture.js";

const execute = promisify(execFile);

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "classifies an outside-root document, then reviews, applies, and commits its move with no owner command",
  { timeout: 90_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const { review, ...initial } = f.delegation!;
    const initialPlan = {
      ...initial,
      canonicalRoots: ["docs", "AGENTS.md", "CLAUDE.md"],
      normalizationRoots: ["docs", "README.md", "AGENTS.md", "CLAUDE.md"],
    };
    await applyConvergenceDelegationPlan(
      f.storage,
      await createConvergenceDelegationPlan(f.storage, {
        ...initialPlan,
        review: { ...review, planHash: convergenceDelegationPlanHash(initialPlan) },
      }),
    );
    await writeFile(resolve(f.root, "TRACE.md"), "# Trace\n\nInspect service traces.\n");
    const executable = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      executable.replace(
        "outcome:'uncertain',routeId:null,roleId:null",
        "outcome:document.path==='TRACE.md'?'route':'uncertain',routeId:document.path==='TRACE.md'?'operations':null,roleId:null",
      ),
    );
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "document-scope",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
    const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
    // ADR-0561: the move needs paths outside the delegation's roots and no scope grant.
    expect(
      missingLifecyclePaths(
        {
          operations: [
            { path: "TRACE.md", action: "move", destinationPath: "docs/operations/TRACE.md" },
          ],
        },
        [...delegation.canonicalRoots, ...delegation.normalizationRoots],
      ),
    ).toEqual(["TRACE.md"]);
    for (
      let cycle = 0;
      cycle < 12 &&
      (await access(resolve(f.root, "TRACE.md")).then(
        () => true,
        () => false,
      ));
      cycle++
    )
      await run();
    await expect(access(resolve(f.root, "TRACE.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(f.root, "docs/operations/TRACE.md"), "utf8")).toContain(
      "Inspect service traces.",
    );
    const callsAfter = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      callsAfter.some(
        (call) =>
          call.request.task === "lifecycle_exact_plan_review" &&
          call.request.untrustedSourceData.sources.some(
            (source: { path: string }) => source.path === "TRACE.md",
          ),
      ),
    ).toBe(true);
    // The move landed as its own Lervo commit carrying the notice fields.
    const { stdout } = await execute("git", [
      "-C",
      f.root,
      "log",
      "--author=knowledge@lervo.invalid",
      "--format=%s%x1f%(trailers:key=Lervo-Effect,valueonly)",
    ]);
    expect(stdout).toContain(
      "docs: apply the cross-checked repository layout\x1frepository_layout",
    );
    const { stdout: tracked } = await execute("git", ["-C", f.root, "ls-files", "docs/operations"]);
    expect(tracked).toContain("docs/operations/TRACE.md");
  },
);

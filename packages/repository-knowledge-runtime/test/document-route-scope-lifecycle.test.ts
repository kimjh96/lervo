import { access, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
} from "../src/delegation-plan.js";
import { convergenceDelegationPlanHash, loadConvergenceDelegation } from "../src/delegation.js";
import { proposeDocumentRouteScope } from "../src/document-route-scope-proposal.js";
import { recordDocumentRouteScopeDecision } from "../src/document-route-scope-decision.js";
import { deferLayoutOutsideScope, missingLifecyclePaths } from "../src/lifecycle-plan-scope.js";
import { inspectDocumentDeferralHealth } from "../src/document-deferral-health.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "classifies an outside-root document, defers without review, records acceptance, and applies the move",
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
    let raw = await createRepositoryLayoutMigrationPlan({ repositoryRoot: f.root });
    for (
      let cycle = 0;
      cycle < 8 && !raw.moves.some((move) => move.fromPath === "TRACE.md");
      cycle++
    ) {
      await run();
      raw = await createRepositoryLayoutMigrationPlan({ repositoryRoot: f.root });
    }
    expect(raw.moves).toContainEqual(
      expect.objectContaining({ fromPath: "TRACE.md", classificationBasis: "semantic_provider" }),
    );
    const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
    const missing = missingLifecyclePaths(raw, [
      ...delegation.canonicalRoots,
      ...delegation.normalizationRoots,
    ]);
    expect(missing).toEqual(["TRACE.md"]);
    expect(deferLayoutOutsideScope(raw, missing).deferredDocuments).toContainEqual(
      expect.objectContaining({ path: "TRACE.md", resolution: "delegation_scope" }),
    );
    expect(await inspectDocumentDeferralHealth({ repositoryRoot: f.root })).toMatchObject({
      deferredDocumentCount: 1,
    });
    await expect(access(resolve(f.root, "TRACE.md"))).resolves.toBeUndefined();
    const callsBefore = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      callsBefore.some(
        (call) =>
          call.request.task === "lifecycle_exact_plan_review" &&
          call.request.untrustedSourceData.sources.some(
            (source: { path: string }) => source.path === "TRACE.md",
          ),
      ),
    ).toBe(false);
    const proposal = (await proposeDocumentRouteScope({ repositoryRoot: f.root, delegation }))!;
    const { review: previousReview, ...current } = delegation;
    const accepted = {
      ...current,
      normalizationRoots: [...current.normalizationRoots, ...proposal.requiredPaths],
    };
    const plan = await createConvergenceDelegationPlan(f.storage, {
      ...accepted,
      review: { ...previousReview, planHash: convergenceDelegationPlanHash(accepted) },
    });
    const evidence = await f.artifacts.put("The owner accepts this exact document scope proposal.");
    await recordDocumentRouteScopeDecision({
      storage: f.storage,
      proposalId: proposal.proposalId,
      response: "accept",
      evidenceArtifactHash: evidence.contentHash,
      delegationPlan: plan,
    });
    for (
      let cycle = 0;
      cycle < 8 &&
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
  },
);

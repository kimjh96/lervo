import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadDecisionTaxonomy } from "@lervo/project";
import {
  createDocumentRouteClassificationRecords,
  createDocumentRouteClassificationRequest,
  createRepositoryLayoutMigrationPlan,
  interpretDocumentRouteClassificationResponse,
  recordDocumentRouteClassifications,
  sha256,
} from "@lervo/repository-knowledge";
import { ConvergenceContinuity } from "../src/convergence-continuity.js";
import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { loadConvergenceDelegation, convergenceDelegationPlanHash } from "../src/delegation.js";
import { proposeDocumentRouteScope } from "../src/document-route-scope-proposal.js";
import { recordDocumentRouteScopeDecision } from "../src/document-route-scope-decision.js";
import { readConvergenceContinuityState } from "../src/continuity-state.js";
import { fixture } from "./fixture.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("proposes all classified outside-root files once at renewal, excludes application content, and clears after owner acceptance", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await writeFile(resolve(f.root, "TRACE.md"), "# Trace\n\nOperator tracing.\n");
  await writeFile(resolve(f.root, "RECOVERY.md"), "# Recovery\n\nOperator recovery.\n");
  await mkdir(resolve(f.root, "application"));
  await writeFile(resolve(f.root, "application/package.json"), '{"name":"rendered-content"}');
  await writeFile(resolve(f.root, "application/view.ts"), "import content from './copy.md';\n");
  await writeFile(resolve(f.root, "application/copy.md"), "# Customer copy\n");
  const taxonomy = await loadDecisionTaxonomy(f.root);
  const documents = await Promise.all(
    ["TRACE.md", "RECOVERY.md"].map(async (path) => {
      const content = await readFile(resolve(f.root, path), "utf8");
      return {
        subject: "document" as const,
        path,
        contentHash: sha256(content),
        content,
        workspacePackage: null,
      };
    }),
  );
  const { request, requestDigest } = createDocumentRouteClassificationRequest({
    taxonomy,
    documents,
  });
  const value = {
    classifications: request.documents.map((document) => ({
      path: document.path,
      contentHash: document.contentHash,
      outcome: "route",
      routeId: "operations",
      roleId: null,
      rationale: "These documents explain service tracing and recovery for operators.",
    })),
  };
  await recordDocumentRouteClassifications({
    repositoryRoot: f.root,
    records: createDocumentRouteClassificationRecords({
      request,
      requestDigest,
      verdicts: interpretDocumentRouteClassificationResponse(request, value),
      provider: "claude",
      responseDigest: sha256(JSON.stringify(value)),
      observationArtifactHash: null,
      classifiedAt: new Date(),
    }),
    liveClassificationIds: new Set<string>(),
  });
  await new ConvergenceOwnership({ storage: f.storage, provider: "claude" }).observe();
  const continuity = new ConvergenceContinuity({
    storage: f.storage,
    policyPath: resolve(f.directory, "continuity-policy.json"),
    hubCandidates: async () => [],
    publication: async () => null,
    hostLabel: "mac",
  });
  const first = await continuity.reconcile();
  expect(first?.scopeChange).toMatchObject({
    recommendation: "accept",
    acceptanceBlocker: null,
    paths: [
      {
        path: "RECOVERY.md",
        classification: "document",
        destination: "docs/operations/RECOVERY.md",
      },
      { path: "TRACE.md", classification: "document", destination: "docs/operations/TRACE.md" },
    ],
  });
  expect(
    first?.findings.filter((finding) => finding.code === "delegation_scope_change"),
  ).toHaveLength(1);
  expect(
    first?.scopeChange?.paths.every((item) =>
      item.evidence.classificationId.startsWith("kdroute_"),
    ),
  ).toBe(true);
  const repeated = await continuity.reconcile({ force: true });
  expect(repeated?.scopeChange).toEqual(first?.scopeChange);
  expect(
    repeated?.findings.filter((finding) => finding.code === "delegation_scope_change"),
  ).toHaveLength(1);
  const evidence = await f.artifacts.put("The owner declines this exact scope proposal.");
  const statePath = resolve(f.root, ".lervo/state/knowledge/convergence-continuity.json");
  const legacyState = JSON.parse(await readFile(statePath, "utf8"));
  delete legacyState.scopeChange.requiredPaths;
  delete legacyState.scopeChange.unsatisfiedPaths;
  await writeFile(statePath, JSON.stringify(legacyState));
  const legacyReading = await readConvergenceContinuityState(f.root);
  expect(legacyReading?.scopeChange).toBeNull();
  expect(
    legacyReading?.findings.some((finding) => finding.code === "delegation_scope_change"),
  ).toBe(false);
  expect((await continuity.reconcile({ force: true }))?.scopeChange?.proposalId).toBe(
    first?.scopeChange?.proposalId,
  );
  await recordDocumentRouteScopeDecision({
    storage: f.storage,
    proposalId: first!.scopeChange!.proposalId,
    response: "decline",
    evidenceArtifactHash: evidence.contentHash,
  });
  const declined = await continuity.reconcile({ force: true });
  expect(declined?.scopeResponse).toBe("decline");
  expect(declined?.findings.some((finding) => finding.code === "delegation_scope_change")).toBe(
    false,
  );
  expect((await continuity.reconcile({ force: true }))?.scopeResponse).toBe("decline");
  // A reference rewrite changes required evidence even when the source classification is unchanged.
  await writeFile(resolve(f.root, "README.md"), "# Repository\n\nSee [trace](TRACE.md).\n");
  const changed = await continuity.reconcile({ force: true });
  expect(changed?.scopeChange?.proposalId).not.toBe(first?.scopeChange?.proposalId);
  expect(changed?.scopeChange?.requiredPaths).toEqual(
    expect.arrayContaining([
      "TRACE.md",
      "RECOVERY.md",
      "docs/operations/TRACE.md",
      "docs/operations/RECOVERY.md",
      "README.md",
    ]),
  );
  expect(changed?.scopeResponse).toBeNull();
  expect(changed?.findings.some((finding) => finding.code === "delegation_scope_change")).toBe(
    true,
  );
  const loaded = (await loadConvergenceDelegation(f.root))!.delegation;
  expect(loaded.normalizationRoots).not.toContain("TRACE.md");
  const sourceOnly = await proposeDocumentRouteScope({
    repositoryRoot: f.root,
    delegation: {
      ...loaded,
      normalizationRoots: [...loaded.normalizationRoots, "TRACE.md", "RECOVERY.md"],
    },
  });
  expect(sourceOnly?.requiredPaths).not.toContain("TRACE.md");
  expect(sourceOnly?.requiredPaths).toContain("docs/operations/TRACE.md");
  expect(sourceOnly?.requiredPaths).toContain("README.md");
  const accepted = {
    ...loaded,
    normalizationRoots: [...loaded.normalizationRoots, ...changed!.scopeChange!.requiredPaths],
  };
  const { review: previousReview, ...plan } = accepted;
  accepted.review = { ...previousReview, planHash: convergenceDelegationPlanHash(plan) };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify(accepted),
  );
  expect(
    await proposeDocumentRouteScope({ repositoryRoot: f.root, delegation: accepted }),
  ).toBeNull();
  expect((await continuity.reconcile({ force: true }))?.scopeChange).toBeNull();
  const layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: f.root });
  expect(layout.retainedDocuments.map((document) => document.path)).toContain(
    "application/copy.md",
  );
  // Preserve the existing authority bound instead of silently widening directories at capacity.
  const directoryGrant = await proposeDocumentRouteScope({
    repositoryRoot: f.root,
    delegation: loaded,
    layout: {
      ...layout,
      operations: [
        ...layout.operations,
        {
          path: "application",
          action: "delete",
          ownership: "user",
          mediaType: "text/markdown",
          expectedCurrentHash: sha256("directory"),
          desiredHash: sha256("deleted"),
        },
      ],
    },
  });
  expect(directoryGrant).toMatchObject({
    acceptanceBlocker: "scope_path_unavailable",
    unsatisfiedPaths: ["application"],
  });
  expect(directoryGrant?.requiredPaths).not.toContain("application");
  const atCapacity = {
    ...loaded,
    normalizationRoots: Array.from({ length: 32 }, (_, index) => `scope-${index}.md`),
  };
  expect(
    await proposeDocumentRouteScope({ repositoryRoot: f.root, delegation: atCapacity, layout }),
  ).toMatchObject({
    acceptanceBlocker: "normalization_root_limit",
    paths: changed?.scopeChange?.paths,
  });
  const { review: capacityReview, ...capacityPlan } = atCapacity;
  atCapacity.review = { ...capacityReview, planHash: convergenceDelegationPlanHash(capacityPlan) };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify(atCapacity),
  );
  const capacityProposal = (await continuity.reconcile({ force: true }))!.scopeChange!;
  expect(capacityProposal.acceptanceBlocker).toBe("normalization_root_limit");
  await recordDocumentRouteScopeDecision({
    storage: f.storage,
    proposalId: capacityProposal.proposalId,
    response: "decline",
    evidenceArtifactHash: evidence.contentHash,
  });
  for (let scan = 0; scan < 2; scan++) {
    const state = await continuity.reconcile({ force: true });
    expect(state?.scopeResponse).toBe("decline");
    expect(state?.findings.some((finding) => finding.code === "delegation_scope_change")).toBe(
      false,
    );
  }
});

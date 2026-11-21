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
import { readConvergenceContinuityState } from "../src/continuity-state.js";
import { fixture } from "./fixture.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("asks no scope change for classified outside-root moves and retires a recorded proposal", async () => {
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
    // ADR-0604: the classifier cites each document by its reference and path.
    classifications: request.documents.map((document, index) => ({
      document: `d${index + 1}`,
      sourcePath: document.path,
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
  // ADR-0561: the reviewed layout plan carries its own exact paths, so no scope grant is asked.
  expect(first).not.toHaveProperty("scopeChange");
  expect(first?.findings.map((finding) => finding.severity)).not.toContain("owner_decision");
  const layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: f.root });
  expect(layout.moves.map((move) => move.fromPath).sort()).toEqual(["RECOVERY.md", "TRACE.md"]);
  expect(layout.retainedDocuments.map((document) => document.path)).toContain(
    "application/copy.md",
  );
  // A proposal and owner decisions an older version recorded read as retired Lervo debt.
  const statePath = resolve(f.root, ".lervo/state/knowledge/convergence-continuity.json");
  const recorded = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(
    statePath,
    JSON.stringify({
      ...recorded,
      scopeChange: {
        proposalId: "kscope_legacy",
        planId: "kplan_legacy",
        requiredPaths: ["TRACE.md"],
        unsatisfiedPaths: [],
      },
      scopeResponse: null,
      findings: [
        ...recorded.findings,
        { code: "delegation_scope_change", severity: "owner_decision", detail: null },
        { code: "policy_invalid", severity: "owner_decision", detail: null },
      ],
    }),
  );
  const legacy = await readConvergenceContinuityState(f.root);
  expect(legacy).not.toHaveProperty("scopeChange");
  expect(legacy).not.toHaveProperty("scopeResponse");
  expect(legacy?.findings.map((finding) => finding.code)).not.toContain("delegation_scope_change");
  expect(legacy?.findings).toContainEqual({
    code: "policy_invalid",
    severity: "lervo_debt",
    detail: null,
  });
  const cleared = await continuity.reconcile({ force: true });
  expect(cleared).not.toHaveProperty("scopeChange");
  expect(JSON.parse(await readFile(statePath, "utf8"))).not.toHaveProperty("scopeChange");
});

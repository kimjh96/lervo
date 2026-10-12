import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest } from "./context-quality-artifact-identity.mjs";
import { validateLexicalV2RealUseReview } from "../../natural-language-evaluation/lexical-v2-real-use-review-contract.mjs";

export async function auditCasePopulation(root) {
  const realPath = "benchmarks/search/lexical-v2-real-use-reviewed-v1.json";
  const raw = await readFile(resolve(root, realPath));
  const suite = validateLexicalV2RealUseReview(JSON.parse(raw), root);
  const legacyPaths = [
    "marker-derived-paths-v6",
    "staged-evidence-v7",
    "linked-evidence-reconciliation-v8",
    "linked-evidence-reconciliation-confirmation-v9",
  ].map((name) => `benchmarks/search/${name}.json`);
  const legacy = await Promise.all(
    legacyPaths.map(async (path) => {
      const bytes = await readFile(resolve(root, path)),
        value = JSON.parse(bytes);
      return {
        path,
        sourceHash: digest(bytes),
        declaredProvenance: value.provenance,
        caseIds: value.cases.map((c) => c.caseId),
        promotion: "retained_reviewed_regression_not_new_real_or_held_out_family",
      };
    }),
  );
  return {
    suite,
    report: {
      schemaVersion: 1,
      realSuite: { path: realPath, sourceHash: digest(raw), review: suite.review },
      realFamilies: suite.cases.map((item) => ({
        familyId: item.caseId,
        caseHash: digest(JSON.stringify(item)),
        queryHash: digest(item.query),
        historicalContextRequired: item.contextRequirement !== "none",
        priorTuningExposure: true,
        newHeldOutEligible: false,
        priorReviewedScope: "retrieval_expected_paths",
        adr0501LabelStatus: "missing_clause_section_negative_and_artifact_labels",
      })),
      retainedRegressions: legacy,
      readiness: {
        status: "not_qualified",
        minimumRealFamilies: 100,
        existingRealFamilies: suite.cases.length,
        additionalRealFamiliesNeeded: Math.max(0, 100 - suite.cases.length),
        minimumHeldOutFamilies: 30,
        eligibleUnseenHeldOutFamilies: 0,
        fullyReviewedAdr0501Families: 0,
        stochasticProviderRuns: 0,
      },
      requiredReviewFields: [
        "immutable task and original context reference",
        "family identity before splitting",
        "corpus version and authorized scope",
        "mandatory clauses with complete conditions and exceptions",
        "evidence roles and acceptable exact sections",
        "irrelevant, stale and conflicting neighbors",
        "artifact constraints and failure/abstention behavior",
        "reviewer identity and exact label digest",
        "prior tuning exposure and family-held-out assignment",
      ],
      privacy:
        "No query, prior-turn, source-body or answer text is copied. Existing owner-readable suites keep their own retention and access boundary.",
    },
  };
}

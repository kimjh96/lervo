import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  calculateKnowledgeCompilationId,
  compareKnowledgeCompilationCandidates,
  compileRepositoryKnowledgeCandidate,
  createCrossProviderExactMergeCandidate,
  createCrossProviderFuzzyMergeCandidate,
  createKnowledgeReconciliationPlan,
  loadKnowledgeCompilationCandidate,
  observeKnowledgeCompilationStability,
  runKnowledgeCompilationStabilityGate,
  scanConfiguredRepositoryKnowledge,
  sha256,
  storeKnowledgeCompilationCandidate,
  type KnowledgeCompilationCandidate,
  type RepositorySemanticCompiler,
  type SemanticCompilerEnvelope,
  type SemanticCompilerResponse,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-compilation-comparison-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    "# Runtime\n\nThe runtime is local-first and policy-bound.\n",
  );
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_compilation_comparison",
      now: new Date("2026-08-23T04:00:00.000Z"),
    }),
  );
  return root;
}

function compiler(
  provider: "codex" | "claude",
  statements: string[],
  includeRelation = false,
  titlePrefix = "Concept",
): RepositorySemanticCompiler {
  return {
    descriptor: {
      compilerId: `fixture.${provider}.semantic`,
      compilerVersion: "1",
      compilerBuildId: `sha256:${(provider === "codex" ? "a" : "b").repeat(64)}`,
      provider,
      isolation: "external_no_capabilities",
    },
    compile: async (envelope: SemanticCompilerEnvelope): Promise<SemanticCompilerResponse> => {
      const evidence = envelope.sourceUnits[0]!.unitVersionId;
      const concepts = statements.map((statement, index) => ({
        localKey: `concept_${index}`,
        title: `${titlePrefix} ${index}`,
        type: "concept" as const,
        summary: `Summary ${index}`,
        claims: [{ localKey: `claim_${index}`, statement, evidenceUnitVersionIds: [evidence] }],
      }));
      return {
        schemaVersion: 1,
        concepts,
        relations:
          includeRelation && concepts.length > 1
            ? [
                {
                  fromConceptKey: concepts[0]!.localKey,
                  toConceptKey: concepts[1]!.localKey,
                  type: "depends_on",
                  evidenceUnitVersionIds: [evidence],
                },
              ]
            : [],
        telemetry: {
          filesystemReads: 0,
          filesystemWrites: 0,
          shellProcesses: 0,
          networkRequests: 0,
          externalActions: 0,
          toolCalls: 0,
          complete: true,
        },
      };
    },
  };
}

async function compilePair(input: {
  root: string;
  codexStatements: string[];
  claudeStatements: string[];
  includeRelation?: boolean;
  claudeTitlePrefix?: string;
}): Promise<{ codex: KnowledgeCompilationCandidate; claude: KnowledgeCompilationCandidate }> {
  const { policy, scan } = await scanConfiguredRepositoryKnowledge(input.root);
  const policyHash = sha256(canonicalJson(policy));
  const codex = await compileRepositoryKnowledgeCandidate({
    scan,
    policyHash,
    compiler: compiler("codex", input.codexStatements, input.includeRelation),
    signal: new AbortController().signal,
  });
  const claude = await compileRepositoryKnowledgeCandidate({
    scan,
    policyHash,
    compiler: compiler(
      "claude",
      input.claudeStatements,
      input.includeRelation,
      input.claudeTitlePrefix,
    ),
    signal: new AbortController().signal,
  });
  await storeKnowledgeCompilationCandidate({ repositoryRoot: input.root, candidate: codex });
  await storeKnowledgeCompilationCandidate({ repositoryRoot: input.root, candidate: claude });
  return { codex, claude };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex-Claude semantic compilation comparison", () => {
  it("recognizes only exact statement/evidence and relation digest overlap", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["The runtime is local-first.", "The runtime is policy-bound."],
      claudeStatements: ["The runtime is local-first.", "The runtime is policy-bound."],
      includeRelation: true,
    });
    const result = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    expect(result).toMatchObject({
      status: "exact_match",
      interpretation: "exact_digest_overlap_only",
      assurance: "unreviewed",
      concepts: { codexCount: 2, claudeCount: 2, exactSharedSignatureCount: 2 },
      claims: { codexCount: 2, claudeCount: 2, exactSharedSignatureCount: 2 },
      relations: { codexCount: 1, claudeCount: 1, exactSharedSignatureCount: 1 },
    });
    expect(
      result.claims.groups.every((group) => group.presence === "both" && group.multiplicityMatch),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("The runtime is local-first.");
    expect(JSON.stringify(result)).not.toContain("README.md");
  });

  it("reports partial overlap without promoting either provider candidate", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["Shared exact claim.", "Codex-only claim."],
      claudeStatements: ["Shared exact claim.", "Claude-only claim."],
    });
    const first = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    const second = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    expect(first.status).toBe("partial_overlap");
    expect(first.claims.groups.map((group) => group.presence).sort()).toEqual([
      "both",
      "claude_only",
      "codex_only",
    ]);
    expect(second).toEqual(first);
    expect(first.comparisonId).toMatch(/^kcompare_[a-f0-9]{24}$/);
  });

  it("rejects provider-coordinate mistakes and stale repository bindings", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["Exact claim."],
      claudeStatements: ["Exact claim."],
    });
    await expect(
      compareKnowledgeCompilationCandidates({
        repositoryRoot: root,
        codexCompilationId: pair.claude.compilationId,
        claudeCompilationId: pair.codex.compilationId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });

    await writeFile(
      resolve(root, "README.md"),
      "# Runtime\n\nThe source changed after compilation.\n",
    );
    await expect(
      compareKnowledgeCompilationCandidates({
        repositoryRoot: root,
        codexCompilationId: pair.codex.compilationId,
        claudeCompilationId: pair.claude.compilationId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
  });

  it("creates only an unreviewed exact-overlap candidate bound to both source artifacts", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["Shared exact claim.", "Codex-only claim."],
      claudeStatements: ["Shared exact claim.", "Claude-only claim."],
    });
    const comparison = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    const merged = await createCrossProviderExactMergeCandidate({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
      comparisonId: comparison.comparisonId,
    });
    expect(merged.candidate).toMatchObject({
      compiler: { provider: "cross_provider", isolation: "deterministic_local_derivation" },
      derivation: {
        kind: "cross_provider_exact_merge",
        comparisonId: comparison.comparisonId,
        sourceCandidates: {
          codex: { compilationId: pair.codex.compilationId },
          claude: { compilationId: pair.claude.compilationId },
        },
      },
    });
    expect(merged.candidate.concepts).toHaveLength(1);
    expect(merged.candidate.concepts[0]?.claims[0]?.statement).toBe("Shared exact claim.");
    expect(merged.candidate.concepts[0]?.assurance).toBe("unreviewed");
    const receipt = await storeKnowledgeCompilationCandidate({
      repositoryRoot: root,
      candidate: merged.candidate,
    });
    expect(
      (
        await loadKnowledgeCompilationCandidate({
          repositoryRoot: root,
          compilationId: receipt.compilationId,
        })
      ).candidate,
    ).toEqual(merged.candidate);

    await expect(
      createCrossProviderExactMergeCandidate({
        repositoryRoot: root,
        codexCompilationId: pair.codex.compilationId,
        claudeCompilationId: pair.claude.compilationId,
        comparisonId: "kcompare_000000000000000000000000",
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
  });

  it("turns only unambiguous source-backed fuzzy pairs into review-required conflicts", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["The runtime remains local first under repository policy."],
      claudeStatements: ["Repository policy keeps the runtime local first."],
    });
    const comparison = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    expect(comparison.status).toBe("disjoint");
    const merged = await createCrossProviderFuzzyMergeCandidate({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
      comparisonId: comparison.comparisonId,
    });
    expect(merged.matches).toEqual([expect.objectContaining({ scoreBasisPoints: 8000 })]);
    expect(merged.candidate).toMatchObject({
      compiler: {
        compilerId: "lervo.cross-provider.approval-gated-fuzzy-merge",
        provider: "cross_provider",
        isolation: "deterministic_local_derivation",
      },
      derivation: {
        kind: "cross_provider_approval_gated_fuzzy_merge",
        comparisonId: comparison.comparisonId,
        similarity: {
          algorithm: "unicode_token_dice_v1",
          thresholdBasisPoints: 6000,
          ambiguityMarginBasisPoints: 1000,
          minimumSharedTokens: 2,
        },
      },
      relations: [],
    });
    expect(merged.candidate.concepts).toHaveLength(2);
    const receipt = await storeKnowledgeCompilationCandidate({
      repositoryRoot: root,
      candidate: merged.candidate,
    });
    const invalid = structuredClone(merged.candidate);
    if (invalid.derivation?.kind !== "cross_provider_approval_gated_fuzzy_merge")
      throw new Error("expected fuzzy derivation");
    invalid.derivation.fuzzyConceptPairs[0]!.scoreBasisPoints = 5999;
    const {
      schemaVersion: _schemaVersion,
      compilationId: _compilationId,
      ...invalidMaterials
    } = invalid;
    invalid.compilationId = calculateKnowledgeCompilationId(invalidMaterials);
    await expect(
      storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate: invalid }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
    const plan = await createKnowledgeReconciliationPlan({
      repositoryRoot: root,
      compilationId: receipt.compilationId,
    });
    expect(plan.status).toBe("review_required");
    expect(plan.dispositions).toHaveLength(2);
    expect(plan.dispositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "conflict",
          review: "review_required",
          reasons: expect.arrayContaining(["fuzzy_cross_provider_candidate"]),
          resolutionOptions: [expect.objectContaining({ action: "create_generated" })],
        }),
      ]),
    );
  });

  it("fails closed when fuzzy similarity is weak or mutually ambiguous", async () => {
    const root = await repository();
    const weak = await compilePair({
      root,
      codexStatements: ["Local execution is available."],
      claudeStatements: ["Credentials rotate through the organization."],
    });
    const weakComparison = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: weak.codex.compilationId,
      claudeCompilationId: weak.claude.compilationId,
    });
    await expect(
      createCrossProviderFuzzyMergeCandidate({
        repositoryRoot: root,
        codexCompilationId: weak.codex.compilationId,
        claudeCompilationId: weak.claude.compilationId,
        comparisonId: weakComparison.comparisonId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });

    const ambiguous = await compilePair({
      root,
      codexStatements: [
        "Repository policy keeps runtime execution local first.",
        "Repository policy keeps runtime operation local first.",
      ],
      claudeStatements: ["Repository policy keeps runtime behavior local first."],
    });
    const ambiguousComparison = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: ambiguous.codex.compilationId,
      claudeCompilationId: ambiguous.claude.compilationId,
    });
    await expect(
      createCrossProviderFuzzyMergeCandidate({
        repositoryRoot: root,
        codexCompilationId: ambiguous.codex.compilationId,
        claudeCompilationId: ambiguous.claude.compilationId,
        comparisonId: ambiguousComparison.comparisonId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
  });

  it("observes same-build repeatability without claiming semantic truth", async () => {
    const root = await repository();
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const policyHash = sha256(canonicalJson(policy));
    const compile = async (statement: string): Promise<KnowledgeCompilationCandidate> =>
      compileRepositoryKnowledgeCandidate({
        scan,
        policyHash,
        compiler: compiler("codex", [statement]),
        signal: new AbortController().signal,
      });
    const baseline = await compile("Stable exact claim.");
    const stableRepeat = await compile("Stable exact claim.");
    const divergentRepeat = await compile("Different generated wording.");
    for (const candidate of [baseline, stableRepeat, divergentRepeat]) {
      await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    }
    const stable = await observeKnowledgeCompilationStability({
      repositoryRoot: root,
      baselineCompilationId: baseline.compilationId,
      candidateCompilationId: stableRepeat.compilationId,
    });
    const divergent = await observeKnowledgeCompilationStability({
      repositoryRoot: root,
      baselineCompilationId: baseline.compilationId,
      candidateCompilationId: divergentRepeat.compilationId,
    });
    expect(stable).toMatchObject({
      status: "stable",
      observationBasis: "candidate_artifacts_only",
      interpretation: "same_build_output_stability_only",
      assurance: "unreviewed",
    });
    expect(divergent.status).toBe("divergent");
    expect(stable.observationId).toMatch(/^kstability_[a-f0-9]{24}$/);
    expect(JSON.stringify(divergent)).not.toContain("Different generated wording.");
    expect(JSON.stringify(divergent)).not.toContain("README.md");
  });

  it("wraps exact shared claims in neutral review concepts when provider summaries differ", async () => {
    const root = await repository();
    const pair = await compilePair({
      root,
      codexStatements: ["The same evidence-bound claim."],
      claudeStatements: ["The same evidence-bound claim."],
      claudeTitlePrefix: "Different provider title",
    });
    const comparison = await compareKnowledgeCompilationCandidates({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
    });
    expect(comparison.concepts.exactSharedSignatureCount).toBe(0);
    expect(comparison.claims.exactSharedSignatureCount).toBe(1);
    const merged = await createCrossProviderExactMergeCandidate({
      repositoryRoot: root,
      codexCompilationId: pair.codex.compilationId,
      claudeCompilationId: pair.claude.compilationId,
      comparisonId: comparison.comparisonId,
    });
    expect(merged.candidate.concepts).toHaveLength(1);
    expect(merged.candidate.concepts[0]?.title).toMatch(
      /^Cross-provider exact claim [a-f0-9]{12}$/,
    );
    expect(merged.candidate.concepts[0]?.claims[0]?.statement).toBe(
      "The same evidence-bound claim.",
    );
    await expect(
      storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate: merged.candidate }),
    ).resolves.toMatchObject({ created: true });
  });

  it("runs the same isolated compiler twice for a live stability gate", async () => {
    const root = await repository();
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const fixture = compiler("claude", ["Exact repeat output."]);
    let calls = 0;
    const gatedCompiler: RepositorySemanticCompiler = {
      descriptor: fixture.descriptor,
      compile: async (envelope, signal) => {
        calls += 1;
        return fixture.compile(envelope, signal);
      },
    };
    const result = await runKnowledgeCompilationStabilityGate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: gatedCompiler,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(2);
    expect(result.observation).toMatchObject({
      status: "stable",
      observationBasis: "two_compile_calls_completed",
    });
    expect(result.baseline.compilationId).toBe(result.candidate.compilationId);
  });
});

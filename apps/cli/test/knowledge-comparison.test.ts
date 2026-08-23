import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  canonicalJson,
  compileRepositoryKnowledgeCandidate,
  scanConfiguredRepositoryKnowledge,
  sha256,
  storeKnowledgeCompilationCandidate,
  type RepositorySemanticCompiler,
  type SemanticCompilerResponse,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex-Claude knowledge comparison CLI", () => {
  it("returns a read-only privacy-bounded exact overlap report", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-knowledge-comparison-"));
    roots.push(root);
    await writeFile(resolve(root, "README.md"), "# Runtime\n\nPrivate comparison fixture body.\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = { cwd: root, stdout: (message: string) => messages.push(message), stderr: (message: string) => errors.push(message) };
    expect(await runCli(["init"], io)).toBe(0);
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const policyHash = sha256(canonicalJson(policy));
    const candidates: Record<"codex" | "claude", string> = { codex: "", claude: "" };
    for (const provider of ["codex", "claude"] as const) {
      const compiler: RepositorySemanticCompiler = {
        descriptor: {
          compilerId: `fixture.${provider}.comparison`,
          compilerVersion: "1",
          compilerBuildId: `sha256:${(provider === "codex" ? "c" : "d").repeat(64)}`,
          provider,
          isolation: "external_no_capabilities",
        },
        compile: async (envelope): Promise<SemanticCompilerResponse> => ({
          schemaVersion: 1,
          concepts: [{
            localKey: "runtime",
            title: "Runtime",
            type: "concept",
            summary: "A candidate that remains unreviewed.",
            claims: [{
              localKey: "local",
              statement: "Exact shared statement that must not be copied into the comparison.",
              evidenceUnitVersionIds: [envelope.sourceUnits[0]!.unitVersionId],
            }],
          }],
          relations: [],
          telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
        }),
      };
      const candidate = await compileRepositoryKnowledgeCandidate({ scan, policyHash, compiler, signal: new AbortController().signal });
      await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
      candidates[provider] = candidate.compilationId;
    }

    messages.length = 0;
    expect(await runCli(["knowledge", "compare", "--codex", candidates.codex, "--claude", candidates.claude, "--json"], io)).toBe(0);
    const output = messages.join("");
    const comparison = JSON.parse(output) as { comparisonId: string; status: string; interpretation: string; assurance: string; claims: { exactSharedSignatureCount: number } };
    expect(comparison).toMatchObject({
      status: "exact_match",
      interpretation: "exact_digest_overlap_only",
      assurance: "unreviewed",
      claims: { exactSharedSignatureCount: 1 },
    });
    expect(output).not.toContain("Exact shared statement");
    expect(output).not.toContain("README.md");
    expect(output).not.toContain(root);

    messages.length = 0;
    expect(await runCli(["knowledge", "stability", "--baseline", candidates.codex, "--candidate", candidates.codex, "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ status: "stable", provider: "codex", assurance: "unreviewed" });

    messages.length = 0;
    expect(await runCli(["knowledge", "merge-candidate", "--comparison", comparison.comparisonId, "--codex", candidates.codex, "--claude", candidates.claude, "--json"], io)).toBe(0);
    const merged = JSON.parse(messages.join("")) as { receipt: { compilationId: string; assurance: string }; comparisonId: string };
    expect(merged).toMatchObject({ comparisonId: comparison.comparisonId, receipt: { assurance: "unreviewed" } });

    messages.length = 0;
    expect(await runCli(["knowledge", "reconcile", merged.receipt.compilationId, "--json"], io)).toBe(0);
    const reconciliation = JSON.parse(messages.join("")) as { reconciliationPlanId: string };
    messages.length = 0;
    expect(await runCli(["knowledge", "review-policy", "--reviewer", "human.comparison", "--write", "--json"], io)).toBe(0);
    const policyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    messages.length = 0;
    expect(await runCli(["knowledge", "review", merged.receipt.compilationId, "--plan", reconciliation.reconciliationPlanId, "--policy", policyPath, "--reviewer", "human.comparison", "--accept-all-safe", "--json"], io)).toBe(0);
    const reviewId = (JSON.parse(messages.join("")) as { review: { reviewId: string } }).review.reviewId;
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", reviewId, "--json"], io)).toBe(0);
    const materializationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", reviewId, "--apply", materializationPlanId, "--json"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    const storage = await openProjectStorage(root);
    try {
      expect(storage.events.list().some((event) => event.type === "knowledge.reconciliation.reviewed")).toBe(true);
      expect(storage.events.list().some((event) => event.type === "knowledge.materialization.applied" && event.payload.operation === "semantic")).toBe(true);
    } finally { await storage.close(); }
    expect(errors).toEqual([]);
  });
});

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const cliEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 12 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`lervo ${args.slice(0, 3).join(" ")} failed (${result.status ?? "signal"})`);
  return JSON.parse(result.stdout);
}

async function main() {
  const pilotRoot = await mkdtemp(resolve(tmpdir(), "lervo-real-knowledge-pilot-"));
  const projectRoot = resolve(pilotRoot, "repository");
  try {
    await mkdir(projectRoot, { mode: 0o700 });
    await writeFile(
      resolve(projectRoot, "README.md"),
      [
        "# Pilot Runtime",
        "",
        "The pilot runtime is local-first.",
        "Every publication requires an explicit human review before materialization.",
        "",
      ].join("\n"),
    );
    run(["init", "--json"], projectRoot);
    const gates = {};
    for (const provider of ["codex", "claude"]) {
      const result = run(
        ["knowledge", "stability", "--provider", provider, "--timeout-ms", "600000", "--json"],
        projectRoot,
      );
      if (
        result.observation?.observationBasis !== "two_compile_calls_completed" ||
        result.receipts?.length !== 2
      ) {
        throw new Error(`${provider} stability evidence is incomplete`);
      }
      gates[provider] = result;
    }
    const comparison = run(
      [
        "knowledge",
        "compare",
        "--codex",
        gates.codex.receipts[0].compilationId,
        "--claude",
        gates.claude.receipts[0].compilationId,
        "--json",
      ],
      projectRoot,
    );
    let merge = { status: "unavailable_no_exact_concept_or_claim" };
    if (
      comparison.concepts.exactSharedSignatureCount + comparison.claims.exactSharedSignatureCount >
      0
    ) {
      const merged = run(
        [
          "knowledge",
          "merge-candidate",
          "--comparison",
          comparison.comparisonId,
          "--codex",
          gates.codex.receipts[0].compilationId,
          "--claude",
          gates.claude.receipts[0].compilationId,
          "--json",
        ],
        projectRoot,
      );
      const reconciliation = run(
        ["knowledge", "reconcile", merged.receipt.compilationId, "--json"],
        projectRoot,
      );
      merge = {
        status: "unreviewed_candidate_created",
        compilationId: merged.receipt.compilationId,
        conceptCount: merged.concepts,
        relationCount: merged.relations,
        reconciliationPlanId: reconciliation.reconciliationPlanId,
        reconciliationStatus: reconciliation.status,
      };
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          providers: Object.fromEntries(
            Object.entries(gates).map(([provider, gate]) => [
              provider,
              {
                stability: gate.observation.status,
                observationBasis: gate.observation.observationBasis,
                observationId: gate.observation.observationId,
                compilerBuildId: gate.observation.compilerBuildId,
                compilationIds: gate.receipts.map((receipt) => receipt.compilationId),
              },
            ]),
          ),
          comparison: {
            comparisonId: comparison.comparisonId,
            status: comparison.status,
            conceptCounts: {
              codex: comparison.concepts.codexCount,
              claude: comparison.concepts.claudeCount,
              exactShared: comparison.concepts.exactSharedSignatureCount,
            },
            claimCounts: {
              codex: comparison.claims.codexCount,
              claude: comparison.claims.claudeCount,
              exactShared: comparison.claims.exactSharedSignatureCount,
            },
            assurance: comparison.assurance,
            interpretation: comparison.interpretation,
          },
          merge,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await rm(pilotRoot, { recursive: true, force: true });
  }
}

await main();

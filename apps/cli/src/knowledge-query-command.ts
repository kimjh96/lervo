import { observeKnowledgeQueryArtifact } from "./knowledge-query-verification.js";
import { projectTaskQuery } from "@lervo/context";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { queryRepositoryKnowledge, repositoryKnowledgeBuilt } from "@lervo/repository-knowledge";
import {
  withRetrievalPreparationBudget,
  type RepositoryQualityInput,
  prepareAppliedInstructionContext,
  productDefaultRepositoryKnowledgeRanker,
} from "@lervo/repository-context";
import { collectInteractiveLocalKnowledgeSources } from "./knowledge-sources.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import type { CliIo } from "./types.js";
import { queryOpenTerminalTurn } from "./terminal-open-turns.js";
import { recordKnowledgeQueryTurnSelection } from "./knowledge-query-turn-selection.js";
import { governingPreference, repositoryPathsNamedIn } from "./governing-preference.js";

export async function runKnowledgeQuery(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        record: { type: "boolean" },
        "verify-artifact": { type: "string" },
        "expected-plan": { type: "string" },
        baseline: { type: "string" },
        "verification-definition": { type: "string" },
        path: { type: "string", multiple: true },
        artifact: { type: "string", multiple: true },
        action: { type: "string", multiple: true },
        continuation: { type: "string" },
      },
    });
    const query = parsed.positionals.join(" ").trim();
    if (query === "") throw new Error("A query sentence is required.");
    if ((parsed.values.path?.length ?? 0) > 64)
      throw new Error("At most 64 target paths are supported.");
    if ((parsed.values.artifact?.length ?? 0) > 32 || (parsed.values.action?.length ?? 0) > 32)
      throw new Error("At most 32 artifact kinds and requested actions are supported.");
    if (
      Boolean(parsed.values["verify-artifact"]) !== Boolean(parsed.values["expected-plan"]) ||
      ((parsed.values.baseline || parsed.values["verification-definition"]) &&
        !parsed.values["verify-artifact"])
    )
      throw new Error(
        "Artifact verification requires --verify-artifact and --expected-plan together.",
      );
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const turn = await queryOpenTerminalTurn(repositoryRoot);
    const supplementalSources = await collectInteractiveLocalKnowledgeSources(repositoryRoot);
    const projection = projectTaskQuery({
      intent: query,
      continuation: parsed.values.continuation ?? "",
      targetPaths: parsed.values.path ?? [],
    });
    // ADR-0556: canonical documents naming the target paths, given or written in the sentence.
    const preferred = await governingPreference(repositoryRoot, [
      ...new Set([...(parsed.values.path ?? []), ...repositoryPathsNamedIn(repositoryRoot, query)]),
    ]);
    const result = await withRetrievalPreparationBudget(() =>
      queryRepositoryKnowledge({
        repositoryRoot,
        query: projection.query,
        supplementalSources,
        ranker: productDefaultRepositoryKnowledgeRanker,
        preferred,
      }),
    );
    const preparation: RepositoryQualityInput = {
      repositoryRoot,
      origin: "terminal",
      recordObservation: true,
      task: {
        intent: query,
        continuation: parsed.values.continuation ?? "",
        targetPaths: parsed.values.path ?? [],
        artifactKinds: parsed.values.artifact ?? [],
        requestedActions: parsed.values.action ?? [],
        conversationLocale: null,
        publicationLocale: null,
        retrievalLanguages: ["en"],
      },
      instructionMaximumBytes: 12 * 1024,
      evidenceMaximumBytes: 12 * 1024,
      retrieval: "completed",
      candidates: result.hits.slice(0, 5),
      sourceSnapshotId: result.sourceSnapshotId,
      retrievalBuildId: result.ranking?.adapterBuildId ?? "",
      projectedQueries: [projection.query],
    };
    const {
      preparation: quality,
      value: { verification, verificationRecording },
    } = await observeKnowledgeQueryArtifact(
      preparation,
      parsed.values["verify-artifact"]
        ? {
            artifactPath: parsed.values["verify-artifact"],
            planDigest: parsed.values["expected-plan"]!,
            ...(parsed.values.baseline ? { baselinePath: parsed.values.baseline } : {}),
            ...(parsed.values["verification-definition"]
              ? { definitionPath: parsed.values["verification-definition"] }
              : {}),
          }
        : null,
    );
    const instructions =
      quality.instructions ??
      (await prepareAppliedInstructionContext({
        repositoryRoot,
        expectedPaths: parsed.values.path ?? null,
        maximumBytes: 12 * 1024,
        targets: {
          artifactKinds: parsed.values.artifact ?? [],
          requestedActions: parsed.values.action ?? [],
        },
      }));
    const knowledgeBuild = (await repositoryKnowledgeBuilt(repositoryRoot)) ? "built" : "not_built";
    await recordKnowledgeQueryTurnSelection({ root: repositoryRoot, turn, hits: result.hits });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ ...result, knowledgeBuild, query, projection, instructions, quality: quality.result, passages: quality.passages, recording: quality.recording, verification, verificationRecording }, null, 2)}\n`
        : [
            `Repository knowledge recommendations (${result.hits.length}; not evidence of loaded, injected, or used)`,
            ...(knowledgeBuild === "built"
              ? []
              : [
                  "Repository knowledge is not built in this checkout, so zero recommendations does not mean no source matches. Run `lervo migrate knowledge`; Git ignores the generated output.",
                ]),
            `Scan coverage: ${result.coverage}; skipped for budget: ${result.skippedForBudget.count} sources, ${result.skippedForBudget.bytes} bytes${result.skippedForBudget.classes.length ? `; classes: ${result.skippedForBudget.classes.join(", ")}` : ""}.`,
            ...(result.retention.observedOnly.count === 0
              ? []
              : [
                  `Find gap (repository scanner): ${result.retention.observedOnly.count} observed-only sources, ${result.retention.observedOnly.bytes} bytes (${result.retention.observedOnly.classes.join(", ")}) are hashed and change-tracked but not searched by symbol or section.`,
                ]),
            ...result.hits.map(
              (hit) =>
                `  ${hit.score.toString().padStart(2)}  ${hit.title} · ${hit.path} · ${hit.freshness}`,
            ),
            `Applied owner instructions: ${instructions.report.status}; ${instructions.report.preparedCount} complete clauses prepared; ${instructions.report.omittedCount ?? "unknown"} omitted; provider delivery unobserved.`,
            ...(instructions.report.status === "complete"
              ? []
              : [
                  "Inspect applicable full rules in docs/instructions/generated/; use --path for known targets. Keep conditions and exceptions intact.",
                ]),
            ...(instructions.context ? [instructions.context] : []),
            `Context quality: ${quality.result.status}; ${quality.result.reasonCodes.join(", ")}.`,
            ...(verification
              ? [
                  `Artifact verification: ${verification.disposition}; ${verification.reasonCodes.join(", ")}.`,
                ]
              : []),
            ...quality.passages.map(
              (passage) =>
                `Exact evidence (${passage.path}; ${passage.contentHash}):\n${passage.content}`,
            ),
            "",
          ].join("\n"),
    );
    return verification && verification.disposition !== "passed" ? 2 : 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

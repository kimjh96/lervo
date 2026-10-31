#!/usr/bin/env node

// Fixture Claude provider for ADR-0463 document freshness. It answers the no-capability JSON
// contract from `document-freshness-plan.json` beside this script, so a test or a local journey
// controls exactly which hunks the "provider" proposes. Each planned hunk names the evidence paths
// it cites; the fixture binds them to the hashes the evidence bundle supplies.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--version")) {
  console.log("claude-freshness-fixture 1.0.0");
  process.exit(0);
}

const directory = dirname(fileURLToPath(import.meta.url));
const planPath = resolve(directory, "document-freshness-plan.json");
const logPath = resolve(directory, "document-freshness-calls.jsonl");
let text = "";
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
if (request.task === "provider_cli_admission_probe") {
  console.log(
    JSON.stringify({
      is_error: false,
      result: '{"ok":true}',
      stop_reason: "end_turn",
      num_turns: 1,
      usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
      modelUsage: {
        fixture: {
          inputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 5,
          contextWindow: 200000,
        },
      },
      permission_denials: [],
    }),
  );
  process.exit(0);
}
appendFileSync(
  logPath,
  `${JSON.stringify({ task: request.task, document: request.untrustedSourceData?.document?.path ?? null })}\n`,
);
if (
  !["document_freshness_candidate", "document_freshness_assessment_review"].includes(request.task)
)
  throw new Error(`Unexpected fixture task ${request.task}`);
const bundle = request.untrustedSourceData;
const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) : {};
const entry = plan[bundle.document.path] ?? {
  operation: "no_change_needed",
  hunks: [],
  explanation: "The fixture plan has no entry for this document.",
};
const cite = (path) => {
  const item = bundle.evidence.find((evidence) => evidence.path === path);
  if (item === undefined) throw new Error(`The bundle has no evidence for ${path}`);
  return { path: item.path, hash: item.hash };
};
const response =
  request.task === "document_freshness_assessment_review"
    ? {
        agrees: entry.assessmentAgrees ?? true,
        documentHash: bundle.document.hash,
        dependencyDigest: bundle.assessmentDependencyDigest,
        explanation: "The complete supplied change leaves the cited document claim unchanged.",
      }
    : {
        operation: entry.operation,
        hunks: (entry.hunks ?? []).map((hunk) => ({
          before: hunk.before,
          after: hunk.after,
          claims: [
            {
              text: hunk.claim ?? `The cited evidence supports replacing "${hunk.before}".`,
              evidence: hunk.evidencePaths.map(cite),
            },
          ],
        })),
        archiveName: entry.archiveName ?? null,
        currentDocumentPath: entry.currentDocumentPath ?? null,
        explanation: entry.explanation ?? "",
      };
console.log(
  JSON.stringify({
    is_error: false,
    result: JSON.stringify(response),
    structured_output: response,
    permission_denials: [],
    stop_reason: "tool_use",
    num_turns: 2,
    usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    modelUsage: {
      fixture: {
        inputTokens: entry.inputTokens ?? 1_200,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: entry.outputTokens ?? 300,
        contextWindow: 200_000,
      },
    },
  }),
);

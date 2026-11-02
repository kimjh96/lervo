#!/usr/bin/env node

// Fixture Claude provider for ADR-0467 owner-turn capture and the ADR-0561 cross-check. It answers
// the no-capability JSON contract from `instruction-capture-plan.json` beside this script, keyed by
// the sha256 digest of the owner turn, so a test decides the semantic classification instead of a model and never
// relies on words in the turn. It logs only digests and whether context arrived.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--version")) {
  console.log("claude-instruction-capture-fixture 1.0.0");
  process.exit(0);
}

const directory = dirname(fileURLToPath(import.meta.url));
const planPath = resolve(directory, "instruction-capture-plan.json");
const logPath = resolve(directory, "instruction-capture-calls.jsonl");
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
if (
  request.task !== "instruction_capture_assessment" &&
  request.task !== "durable_instruction_cross_check"
)
  throw new Error(`Unexpected fixture task ${request.task}`);
const crossCheck = request.task === "durable_instruction_cross_check";
const ownerText = crossCheck ? request.untrustedOwnerText : request.untrustedOwnerTurn;
const digest = `sha256:${createHash("sha256").update(ownerText).digest("hex")}`;
appendFileSync(
  logPath,
  `${JSON.stringify({
    task: request.task,
    surface: request.surface,
    ownerTurnDigest: digest,
    precedingAgentTurnPresent: request.untrustedPrecedingAgentTurn !== null,
    catalogEntryCount: request.semanticCatalog?.canonicalInstructions?.entries?.length ?? null,
    pendingOwnerRuleCount: request.semanticCatalog?.pendingOwnerRules?.length ?? null,
  })}\n`,
);
const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) : {};
const entry = plan[digest];
if (entry?.fail === true || (crossCheck && entry?.crossCheck === "fail")) process.exit(3);
const none = {
  disposition: "none",
  speechAct: "other",
  authority: "inferred",
  durability: "unspecified",
  operation: "none",
  scope: { kind: "unspecified", paths: [] },
  title: null,
  statement: null,
  exceptions: [],
  risk: "unknown",
  conflict: "unknown",
  confidence: "low",
  reasonIds: [],
};
// ADR-0561 cross-check: the plan's `crossCheck` verdict, agreeing by default.
const response = crossCheck
  ? {
      schemaVersion: 1,
      verdict: entry?.crossCheck === "disagree" ? "disagree" : "agree",
      reasonIds: ["fixture_cross_check"],
    }
  : (entry?.response ?? {
      schemaVersion: 1,
      captureClass: "none",
      durableInstruction: none,
      decision: null,
      reasonIds: ["fixture_plan_missing"],
    });
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
        inputTokens: 900,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 150,
        contextWindow: 200_000,
      },
    },
  }),
);

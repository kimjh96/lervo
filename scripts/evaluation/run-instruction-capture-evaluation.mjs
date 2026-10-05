// Records one real-provider observation per case of the ADR-0466 owner-turn capture suite.
// Usage: node scripts/evaluation/run-instruction-capture-evaluation.mjs --provider <claude|codex>
// It sends each verification-authored turn through the same no-capability assessment contract the
// knowledge resident uses, with this repository's canonical-instruction catalog, and rewrites the
// suite's `observation` block. Build the workspace first (`pnpm build`).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  inspectDurableInstructionCatalog,
  instructionCaptureAssessmentInstruction,
  instructionCaptureRequest,
  parseInstructionCaptureAssessment,
  scanConfiguredRepositoryKnowledge,
} from "../../packages/repository-knowledge/dist/index.js";
import { createNoCapabilityProviderJsonRunner } from "../../packages/repository-knowledge-compiler/dist/index.js";
import { validateInstructionCaptureSuite } from "../natural-language-evaluation/instruction-capture-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suitePath = resolve(repositoryRoot, "benchmarks/grounding/instruction-capture-v1.json");
const { values } = parseArgs({
  options: { provider: { type: "string" }, concurrency: { type: "string" } },
});
const provider = values.provider;
if (provider !== "claude" && provider !== "codex")
  throw new Error("--provider must be claude or codex.");
const concurrency = Math.max(1, Math.min(4, Number(values.concurrency ?? 3)));

const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const catalog = inspectDurableInstructionCatalog(
  await scanConfiguredRepositoryKnowledge(repositoryRoot),
);
const runner = await createNoCapabilityProviderJsonRunner({
  provider,
  systemPrompt: instructionCaptureAssessmentInstruction,
  timeoutMs: 180_000,
});
const results = new Array(suite.cases.length);
let next = 0;
async function worker() {
  while (next < suite.cases.length) {
    const index = next;
    next += 1;
    const item = suite.cases[index];
    const request = instructionCaptureRequest({
      surface: item.surface,
      ownerTurn: item.ownerTurn,
      precedingAgentTurn: item.precedingAgentTurn,
      semanticCatalog: catalog.semanticCatalog,
    });
    let assessment;
    // One retry absorbs a transient provider or adapter-boundary failure; a second one stops the run.
    for (let attempt = 1; assessment === undefined; attempt += 1) {
      try {
        assessment = parseInstructionCaptureAssessment(await runner.resolve(request));
      } catch (error) {
        if (attempt >= 2) throw error;
        process.stderr.write(
          `${item.caseId}: attempt ${attempt} failed (${error.code ?? error.name}); retrying\n`,
        );
      }
    }
    results[index] = {
      caseId: item.caseId,
      observedClass: assessment.captureClass,
      durableDisposition: assessment.durableInstruction.disposition,
    };
    process.stderr.write(
      `${item.caseId}: expected ${item.expectedClass}, observed ${assessment.captureClass} (${assessment.durableInstruction.disposition})\n`,
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
suite.observation = {
  provider,
  adapterId: `${provider}/no-capability-json`,
  observedAt: new Date().toISOString(),
  results,
};
writeFileSync(suitePath, `${JSON.stringify(suite, null, 2)}\n`);
console.log(JSON.stringify(validateInstructionCaptureSuite(suite)));

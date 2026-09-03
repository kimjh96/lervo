import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  foundationThreatModel,
  verifyFoundationAdverseEvidenceReport,
} from "../../packages/execution-reliability/dist/index.js";
import { hashFoundationAdverseSuites } from "./adverse/suite-bindings.mjs";
import { foundationSourceRevision } from "./evidence/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const parsed = parseArgs({
  args,
  strict: true,
  options: { area: { type: "string" } },
});
if (
  parsed.values.area !== undefined &&
  !["recovery", "concurrency", "security", "compatibility", "capacity"].includes(parsed.values.area)
) {
  throw new TypeError("The requested foundation adverse-condition area is invalid.");
}
const evidencePath = resolve(repositoryRoot, "docs/evidence/foundation/adverse-condition-v1.json");
const report = verifyFoundationAdverseEvidenceReport(
  JSON.parse(await readFile(evidencePath, "utf8")),
);
if (report.repositoryRevision !== (await foundationSourceRevision(repositoryRoot))) {
  throw new Error("Foundation adverse-condition evidence does not match current source bytes.");
}
const currentSuites = await hashFoundationAdverseSuites(repositoryRoot);
if (
  JSON.stringify(report.evidenceSuites) !==
  JSON.stringify([...currentSuites].sort((left, right) => left.path.localeCompare(right.path)))
) {
  throw new Error("Foundation adverse-condition suite evidence changed.");
}
for (const path of new Set(foundationThreatModel.flatMap((threat) => threat.evidencePaths))) {
  await readFile(resolve(repositoryRoot, path));
}
if (
  parsed.values.area !== undefined &&
  parsed.values.area !== "capacity" &&
  !report.evidenceSuites.some((item) => item.area === parsed.values.area)
) {
  throw new Error(`Foundation adverse-condition evidence has no ${parsed.values.area} suite.`);
}
process.stdout.write(
  `Foundation adverse-condition evidence passed: ${report.reportId} (${report.effects.length} effects, ${report.recoveryScenarios.length} recovery scenarios, ${report.threats.length} threats, ${report.capacityProfiles.length} capacity profiles).\n`,
);

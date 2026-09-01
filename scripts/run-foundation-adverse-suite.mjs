import { writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createFoundationAdverseEvidenceReport,
  foundationCapacityProfiles,
} from "../packages/execution-reliability/dist/index.js";
import { observeFoundationCapacityProfile } from "./foundation-adverse/capacity-observation.mjs";
import { hashFoundationAdverseSuites } from "./foundation-adverse/suite-bindings.mjs";
import { foundationSourceRevision } from "./foundation-evidence/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const parsed = parseArgs({
  args,
  strict: true,
  options: { write: { type: "string" }, summary: { type: "boolean" } },
});
const capacityProfiles = [];
for (const profile of foundationCapacityProfiles) {
  capacityProfiles.push(await observeFoundationCapacityProfile(profile));
}
const report = createFoundationAdverseEvidenceReport({
  repositoryRevision: await foundationSourceRevision(repositoryRoot),
  environment: { operatingSystem: platform(), architecture: arch(), nodeVersion: process.version },
  capacityProfiles,
  evidenceSuites: await hashFoundationAdverseSuites(repositoryRoot),
});
const output = `${JSON.stringify(report, null, 2)}\n`;
if (parsed.values.write) await writeFile(resolve(repositoryRoot, parsed.values.write), output);
process.stdout.write(
  parsed.values.summary
    ? `${JSON.stringify(
        {
          reportId: report.reportId,
          allPassed: report.allPassed,
          effects: report.effects.length,
          recoveryScenarios: report.recoveryScenarios.length,
          telemetryFields: report.telemetry.fieldCount,
          threats: report.threats.length,
          growingCollections: report.growingCollections.length,
          capacityProfiles: report.capacityProfiles.map((item) => ({
            profileId: item.profileId,
            durationMs: item.durationMs,
            cpuMs: item.cpuMs,
            processPeakResidentMemoryBytes: item.processPeakResidentMemoryBytes,
          })),
        },
        null,
        2,
      )}\n`
    : output,
);

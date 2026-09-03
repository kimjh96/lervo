import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  foundationReadinessChecks,
  hashFoundationReadinessSuites,
} from "./readiness/check-bindings.mjs";
import { verifyFoundationReadinessReport } from "./readiness/report.mjs";
import { foundationSourceRevision } from "./evidence/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const report = verifyFoundationReadinessReport(
  JSON.parse(
    await readFile(
      resolve(repositoryRoot, "docs/evidence/foundation/foundation-readiness-v1.json"),
      "utf8",
    ),
  ),
);
if (report.repositoryRevision !== (await foundationSourceRevision(repositoryRoot))) {
  throw new Error("Foundation readiness evidence does not match current source bytes.");
}
if (
  JSON.stringify(report.suiteBindings) !==
  JSON.stringify(await hashFoundationReadinessSuites(repositoryRoot))
) {
  throw new Error("Foundation readiness suite bindings changed.");
}
const expectedIds = [
  ...foundationReadinessChecks.map((item) => item.checkId),
  "release_completion",
];
if (JSON.stringify(report.checkIds) !== JSON.stringify(expectedIds)) {
  throw new Error("Foundation readiness check inventory changed.");
}
for (const constituent of report.constituentReports) {
  const content = await readFile(resolve(repositoryRoot, constituent.path));
  const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (hash !== constituent.contentHash) throw new Error(`${constituent.path} changed.`);
}
process.stdout.write(
  `Foundation readiness evidence passed: ${report.reportId} (3 observations, ${report.checkIds.length} checks each).\n`,
);

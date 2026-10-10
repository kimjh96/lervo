import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openReadOnlyProjectStorage } from "../../packages/project-storage/dist/index.js";
import { validateSchema } from "../../packages/schemas/dist/index.js";
import { auditCasePopulation } from "./lib/context-quality-case-audit.mjs";
import { auditHistoricalProvenance } from "./lib/context-quality-provenance.mjs";
import { digest, artifactBuildHash } from "./lib/context-quality-artifact-identity.mjs";
const root = resolve(import.meta.dirname, "../..");
const protocolBytes = await readFile(
  resolve(root, "benchmarks/context-quality/historical-provenance-v1.json"),
);
const protocol = JSON.parse(protocolBytes);
const { suite, report: population } = await auditCasePopulation(root);
const harnessPaths = [
  "scripts/evaluation/run-context-quality-provenance-audit.mjs",
  "scripts/evaluation/lib/context-quality-provenance.mjs",
  "scripts/evaluation/lib/context-quality-case-audit.mjs",
  "scripts/natural-language-evaluation/lexical-v2-real-use-review-contract.mjs",
];
const harnessHashes = await Promise.all(
  harnessPaths.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
);
const buildHash = await artifactBuildHash(root);
const storage = await openReadOnlyProjectStorage(root);
try {
  const report = await auditHistoricalProvenance(
    storage,
    suite,
    protocol,
    (snapshot) => validateSchema("workstreamSnapshot", snapshot).valid,
  );
  process.stdout.write(
    JSON.stringify(
      {
        protocolHash: digest(protocolBytes),
        artifactBuildHash: buildHash,
        harnessHashes,
        declaredHistoricalCorpus: protocol.historicalCorpus,
        exactHistoricalCorpusRestored: false,
        reviewedSuite: population.realSuite,
        ...report,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await storage.close();
}

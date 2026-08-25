import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const failures = [];

const requiredDocuments = [
  "docs/product/vision.md",
  "docs/architecture/system.md",
  "docs/specifications/execution.md",
  "docs/roadmap/v0.md",
  "docs/decisions/execution/orchestration/0015-lervo-run-cli-vertical-slice.md",
];
const retiredDocuments = [
  "ROVEN_VISION.md",
  "ROVEN_ARCHITECTURE.md",
  "ROVEN_EXECUTION_SPEC.md",
  "ROVEN_V0_PLAN.md",
  "docs/decisions/execution/orchestration/0015-roven-run-cli-vertical-slice.md",
];
const previousBrandAllowlist = new Set([
  "README.md",
  "docs/architecture/system.md",
  "docs/specifications/execution.md",
  "docs/roadmap/v0.md",
  "docs/decisions/foundation/0020-lervo-product-identity.md",
  "packages/project/src/layout.ts",
  "packages/project/test/project-init.test.ts",
  "packages/identity-migration/src/plan.ts",
  "packages/identity-migration/src/types.ts",
  "packages/identity-migration/test/identity-migration.test.ts",
  "docs/decisions/knowledge/repository/0144-explicit-project-identity-migration.md",
]);
const previousMarkerAllowlist = new Set([
  "docs/decisions/knowledge/documents/0021-commonmark-managed-block-parser.md",
]);
const brandCheckPath = "scripts/check-brand.mjs";

for (const path of requiredDocuments) {
  if (!existsSync(resolve(repositoryRoot, path)))
    failures.push(`Required Lervo document is missing: ${path}`);
}
for (const path of retiredDocuments) {
  if (existsSync(resolve(repositoryRoot, path)))
    failures.push(`A document with the previous name remains: ${path}`);
}

const packagePaths = [
  ...readdirSync(resolve(repositoryRoot, "apps"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `apps/${entry.name}/package.json`)
    .filter((path) => existsSync(resolve(repositoryRoot, path))),
  ...readdirSync(resolve(repositoryRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((path) => existsSync(resolve(repositoryRoot, path))),
];
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
if (rootPackage.name !== "lervo") failures.push("The root package name must be lervo.");
if (!/^\d+\.\d+\.\d+$/.test(rootPackage.version ?? "")) {
  failures.push("The root package version must be a valid semantic version.");
}
if (rootPackage.scripts?.lervo !== "node apps/cli/dist/bin.js") {
  failures.push("The root package lervo CLI script differs from the expected path.");
}

for (const path of packagePaths) {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@lervo/")) {
    failures.push(`${path}: the package name is outside the @lervo scope.`);
  }
  if (manifest.name === "@lervo/cli" && !/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
    failures.push(`${path}: the public CLI version must be a valid semantic version.`);
  } else if (manifest.name !== "@lervo/cli" && manifest.version !== rootPackage.version) {
    failures.push(`${path}: the package version differs from root ${rootPackage.version}.`);
  }
}

const cliPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
);
if (
  cliPackage.bin?.lervo !== "./dist/bin.js" ||
  cliPackage.bin?.["lervo-node"] !== "./dist/node-runtime.js" ||
  Object.keys(cliPackage.bin ?? {}).length !== 2
) {
  failures.push("The CLI package must expose the lervo and lervo-node binaries.");
}

const trackedAndNewFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

for (const path of trackedAndNewFiles) {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) continue;
  let content;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }
  if (path !== brandCheckPath && /Roven|ROVEN|@roven/.test(content)) {
    failures.push(`${path}: a previous product identifier remains.`);
  }
  const withoutStandardTerms = content
    .replaceAll("provenance", "")
    .replaceAll("Provenance", "")
    .replaceAll("unproven", "")
    .replaceAll("Unproven", "")
    .replaceAll("proven", "")
    .replaceAll("Proven", "");
  if (path !== brandCheckPath && withoutStandardTerms.includes("roven")) {
    let withoutPreviousIdentity = withoutStandardTerms.replaceAll(".roven", "");
    if (previousMarkerAllowlist.has(path)) {
      withoutPreviousIdentity = withoutPreviousIdentity.replaceAll("<!-- roven:", "");
    }
    if (
      withoutPreviousIdentity.includes("roven") ||
      (!previousBrandAllowlist.has(path) && !previousMarkerAllowlist.has(path))
    ) {
      failures.push(`${path}: a disallowed lowercase previous identifier remains.`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Lervo identity check passed (${packagePaths.length + 1} packages)`);
}

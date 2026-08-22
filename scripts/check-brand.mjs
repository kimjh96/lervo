import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const failures = [];

const requiredDocuments = [
  "LERVO_VISION.md",
  "LERVO_ARCHITECTURE.md",
  "LERVO_EXECUTION_SPEC.md",
  "LERVO_V0_PLAN.md",
  "docs/adr/0015-lervo-run-cli-vertical-slice.md",
];
const retiredDocuments = [
  "ROVEN_VISION.md",
  "ROVEN_ARCHITECTURE.md",
  "ROVEN_EXECUTION_SPEC.md",
  "ROVEN_V0_PLAN.md",
  "docs/adr/0015-roven-run-cli-vertical-slice.md",
];
const previousBrandAllowlist = new Set([
  "README.md",
  "LERVO_ARCHITECTURE.md",
  "LERVO_EXECUTION_SPEC.md",
  "LERVO_V0_PLAN.md",
  "docs/adr/0020-lervo-product-identity.md",
  "packages/project/src/layout.ts",
  "packages/project/test/project-init.test.ts",
  "packages/identity-migration/src/plan.ts",
  "packages/identity-migration/src/types.ts",
  "packages/identity-migration/test/identity-migration.test.ts",
  "docs/adr/0144-explicit-project-identity-migration.md",
]);
const previousMarkerAllowlist = new Set([
  "docs/adr/0021-commonmark-managed-block-parser.md",
]);
const brandCheckPath = "scripts/check-brand.mjs";

for (const path of requiredDocuments) {
  if (!existsSync(resolve(repositoryRoot, path))) failures.push(`필수 Lervo 문서가 없습니다: ${path}`);
}
for (const path of retiredDocuments) {
  if (existsSync(resolve(repositoryRoot, path))) failures.push(`이전 이름의 문서가 남아 있습니다: ${path}`);
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
if (rootPackage.name !== "lervo") failures.push("root package 이름은 lervo여야 합니다.");
if (!/^\d+\.\d+\.\d+$/.test(rootPackage.version ?? "")) {
  failures.push("root package version은 정식 semantic version이어야 합니다.");
}
if (rootPackage.scripts?.lervo !== "node apps/cli/dist/bin.js") {
  failures.push("root package의 lervo CLI script가 예상 경로와 다릅니다.");
}

for (const path of packagePaths) {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@lervo/")) {
    failures.push(`${path}: package 이름이 @lervo scope가 아닙니다.`);
  }
  if (manifest.version !== rootPackage.version) {
    failures.push(`${path}: package version이 root ${rootPackage.version}와 다릅니다.`);
  }
}

const cliPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"));
if (cliPackage.bin?.lervo !== "./dist/bin.js" || Object.keys(cliPackage.bin ?? {}).length !== 1) {
  failures.push("CLI package는 lervo bin 하나만 공개해야 합니다.");
}

const trackedAndNewFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot, encoding: "utf8" },
).split("\0").filter(Boolean);

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
    failures.push(`${path}: 이전 제품 식별자가 남아 있습니다.`);
  }
  const withoutStandardTerms = content
    .replaceAll("provenance", "")
    .replaceAll("Provenance", "");
  if (path !== brandCheckPath && withoutStandardTerms.includes("roven")) {
    let withoutPreviousIdentity = withoutStandardTerms.replaceAll(".roven", "");
    if (previousMarkerAllowlist.has(path)) {
      withoutPreviousIdentity = withoutPreviousIdentity.replaceAll("<!-- roven:", "");
    }
    if (withoutPreviousIdentity.includes("roven") ||
        (!previousBrandAllowlist.has(path) && !previousMarkerAllowlist.has(path))) {
      failures.push(`${path}: 허용되지 않은 이전 소문자 식별자가 남아 있습니다.`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Lervo 식별자 검사 통과 (${packagePaths.length + 1}개 package)`);
}

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hangul = /[\u3131-\u318E\uAC00-\uD7A3]/u;
const textExtensions = new Set([
  ".c", ".css", ".html", ".js", ".json", ".jsx", ".mjs", ".md", ".mdx",
  ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const ignoredDirectories = new Set([
  ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "vendor",
]);

function extension(path) {
  const match = path.match(/(\.[^./]+)$/u);
  return match?.[1]?.toLowerCase() ?? "";
}

function shouldIgnoreDirectory(path, name) {
  if (ignoredDirectories.has(name)) return true;
  if (path === ".lervo/state" || path === ".lervo/generated") return true;
  return path.includes("-dependencies/") || path.endsWith("-dependencies");
}

function categoryFor(path) {
  if (path.startsWith("docs/knowledge/") || path.startsWith(".lervo/knowledge/")) return "generated_knowledge";
  if (path.includes("/test/") || /(?:^|\/)test[^/]*\.[^/]+$/u.test(path) || /\.test\.[^/]+$/u.test(path)) return "test_fixture";
  if (
    path === "README.md" || path === "AGENTS.md" || path === "CLAUDE.md" ||
    path.startsWith("docs/") || /(?:^|\/)(?:README|DISTRIBUTION_README)\.md$/u.test(path)
  ) return "documentation";
  if (
    /^(?:apps|packages)\/[^/]+\/(?:src|assets)\//u.test(path) ||
    path.startsWith("scripts/")
  ) return "runtime_surface";
  if (/\.(?:json|toml|yaml|yml)$/u.test(path)) return "metadata";
  return "other_source";
}

async function walk(root, directory = "") {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!shouldIgnoreDirectory(path, entry.name)) files.push(...await walk(root, path));
      continue;
    }
    if (entry.isFile() && textExtensions.has(extension(path))) files.push(path);
  }
  return files;
}

export async function auditProductLanguage(repositoryRoot) {
  const findings = [];
  for (const path of await walk(repositoryRoot)) {
    const content = await readFile(resolve(repositoryRoot, path), "utf8");
    if (!hangul.test(content)) continue;
    const lines = content.split(/\r?\n/u);
    const lineNumbers = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (hangul.test(lines[index])) lineNumbers.push(index + 1);
    }
    findings.push({ path, category: categoryFor(path), lineCount: lineNumbers.length, lineNumbers });
  }
  const categories = {};
  for (const finding of findings) {
    const current = categories[finding.category] ?? { fileCount: 0, lineCount: 0 };
    current.fileCount += 1;
    current.lineCount += finding.lineCount;
    categories[finding.category] = current;
  }
  return {
    schemaVersion: 1,
    repositoryRoot: resolve(repositoryRoot),
    inspectedLanguage: "en",
    detector: "unicode-hangul-v1",
    fileCount: findings.length,
    lineCount: findings.reduce((total, finding) => total + finding.lineCount, 0),
    categories,
    findings,
  };
}

function formatReport(report) {
  const lines = [
    "Lervo English product-surface audit",
    `Repository: ${report.repositoryRoot}`,
    `Non-English findings: ${report.fileCount} files, ${report.lineCount} lines`,
    "",
  ];
  for (const [category, counts] of Object.entries(report.categories).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${category}: ${counts.fileCount} files, ${counts.lineCount} lines`);
  }
  if (report.findings.length > 0) {
    lines.push("", "Files:");
    for (const finding of report.findings) {
      const preview = finding.lineNumbers.slice(0, 12).join(",");
      const suffix = finding.lineNumbers.length > 12 ? ",…" : "";
      lines.push(`- ${finding.category} ${finding.path}:${preview}${suffix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => arg !== "--json" && arg !== "--strict");
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  const report = await auditProductLanguage(process.cwd());
  process.stdout.write(args.has("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  if (args.has("--strict") && report.fileCount > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

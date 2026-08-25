import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleDocuments = [
  "docs/product/vision.md",
  "docs/architecture/system.md",
  "docs/specifications/execution.md",
  "docs/roadmap/v0.md",
];
async function markdownUnder(directory) {
  const entries = await readdir(resolve(repositoryRoot, directory), {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map(
      (entry) =>
        `${entry.parentPath
          .slice(repositoryRoot.length + 1)
          .split("\\")
          .join("/")}/${entry.name}`,
    )
    .sort();
}
const decisionTaxonomy = parse(
  await readFile(resolve(repositoryRoot, ".lervo/knowledge/document-layout.yaml"), "utf8"),
);
if (
  decisionTaxonomy?.schemaVersion !== 1 ||
  typeof decisionTaxonomy.decisionRoot !== "string" ||
  !Number.isSafeInteger(decisionTaxonomy.maxLeafDocuments) ||
  !Array.isArray(decisionTaxonomy.routes) ||
  !decisionTaxonomy.routes.every((route) => typeof route?.path === "string")
)
  throw new Error(
    ".lervo/knowledge/document-layout.yaml does not satisfy the documentation lifecycle contract.",
  );
const adrDocuments = await markdownUnder(decisionTaxonomy.decisionRoot);
const migrationDocuments = (
  await readdir(resolve(repositoryRoot, "docs/migrations"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => `docs/migrations/${entry.name}`)
  .sort();
const knowledgeDesignDocuments = (
  await Promise.all(
    ["docs/research", "docs/specs"].map(async (directory) =>
      (await readdir(resolve(repositoryRoot, directory), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => `${directory}/${entry.name}`),
    ),
  )
)
  .flat()
  .sort();
const approvedRootMarkdown = new Set([
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
]);
const rootMarkdown = (await readdir(repositoryRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name)
  .sort();
const markdownDocuments = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ...rootMarkdown.filter(
    (path) =>
      approvedRootMarkdown.has(path) && !["README.md", "AGENTS.md", "CLAUDE.md"].includes(path),
  ),
  ...lifecycleDocuments,
  ...adrDocuments,
  ...migrationDocuments,
  ...knowledgeDesignDocuments,
];

const failures = [];
const decisionLeafCounts = new Map();
const allowedDecisionLeaves = new Set(
  decisionTaxonomy.routes.map((route) => `${decisionTaxonomy.decisionRoot}/${route.path}`),
);
for (const document of adrDocuments.filter((path) => /(?:^|\/)\d{4}-.+\.md$/u.test(path))) {
  const parent = dirname(document);
  if (!allowedDecisionLeaves.has(parent))
    failures.push(`${document}: decision parent is not an allowed taxonomy route.`);
  decisionLeafCounts.set(parent, (decisionLeafCounts.get(parent) ?? 0) + 1);
}
for (const [directory, count] of decisionLeafCounts) {
  if (count > decisionTaxonomy.maxLeafDocuments)
    failures.push(
      `${directory}: ${count} decision documents exceeds the ${decisionTaxonomy.maxLeafDocuments}-file leaf bound; add a semantic route.`,
    );
}
for (const legacyRoot of decisionTaxonomy.legacyRoots ?? []) {
  try {
    const legacy = await readdir(resolve(repositoryRoot, legacyRoot), {
      withFileTypes: true,
      recursive: true,
    });
    if (legacy.some((entry) => entry.isFile() && /^\d{4}-.+\.md$/u.test(entry.name)))
      failures.push(`${legacyRoot}: legacy ADR storage is retired; run lervo migrate knowledge.`);
  } catch {
    /* absent is canonical */
  }
}
const documentBounds = new Map([
  ["README.md", { bytes: 12_288, lines: 160 }],
  ["AGENTS.md", { bytes: 8_192, lines: 120 }],
  ["CLAUDE.md", { bytes: 2_048, lines: 40 }],
]);
const defaultBounds = { bytes: 16_384, lines: 240 };

for (const path of rootMarkdown) {
  if (!approvedRootMarkdown.has(path)) {
    failures.push(
      `${path}: root Markdown is not an approved short entrypoint; move the concern to docs/.`,
    );
  }
}

for (const document of lifecycleDocuments) {
  const content = await readFile(resolve(repositoryRoot, document), "utf8");
  if (!/^Status: `[^`]+`/m.test(content)) {
    failures.push(`${document}: missing Status metadata.`);
  }
  if (!/^As of: \d{4}-\d{2}-\d{2}/m.test(content)) {
    failures.push(`${document}: missing As of metadata.`);
  }
}

for (const document of markdownDocuments) {
  const absoluteDocument = resolve(repositoryRoot, document);
  const content = await readFile(absoluteDocument, "utf8");
  const bounds = documentBounds.get(document) ?? defaultBounds;
  const byteCount = Buffer.byteLength(content);
  const lineCount = content === "" ? 0 : content.split(/\r?\n/u).length;
  if (byteCount > bounds.bytes) {
    failures.push(
      `${document}: ${byteCount} bytes exceeds the ${bounds.bytes}-byte document bound; split independent concerns.`,
    );
  }
  if (lineCount > bounds.lines) {
    failures.push(
      `${document}: ${lineCount} lines exceeds the ${bounds.lines}-line document bound; split independent concerns.`,
    );
  }
  const links = content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = match[1];
    if (!target || /^(?:https?:|#)/.test(target)) {
      continue;
    }
    const path = target.split("#", 1)[0];
    if (!path) {
      continue;
    }
    try {
      await access(resolve(dirname(absoluteDocument), path));
    } catch {
      failures.push(`${document}: link target does not exist: ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation lifecycle checks passed (${markdownDocuments.length} documents)`);
}

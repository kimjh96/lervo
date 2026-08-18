import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleDocuments = [
  "LERVO_VISION.md",
  "LERVO_ARCHITECTURE.md",
  "LERVO_EXECUTION_SPEC.md",
  "LERVO_V0_PLAN.md",
];
const adrDocuments = (await readdir(resolve(repositoryRoot, "docs/adr"), {
  withFileTypes: true,
}))
  .filter((entry) => entry.isFile() && /^\d{4}-.+\.md$/.test(entry.name))
  .map((entry) => `docs/adr/${entry.name}`)
  .sort();
const markdownDocuments = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ...lifecycleDocuments,
  ...adrDocuments,
];

const failures = [];

for (const document of lifecycleDocuments) {
  const content = await readFile(resolve(repositoryRoot, document), "utf8");
  if (!/^상태: `[^`]+`/m.test(content)) {
    failures.push(`${document}: 상태 metadata가 없습니다.`);
  }
  if (!/^기준일: \d{4}-\d{2}-\d{2}/m.test(content)) {
    failures.push(`${document}: 기준일 metadata가 없습니다.`);
  }
}

for (const document of markdownDocuments) {
  const absoluteDocument = resolve(repositoryRoot, document);
  const content = await readFile(absoluteDocument, "utf8");
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
      failures.push(`${document}: 존재하지 않는 링크 ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`문서 수명주기 기본 검사 통과 (${markdownDocuments.length}개 문서)`);
}

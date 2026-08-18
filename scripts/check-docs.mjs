import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleDocuments = [
  "ROVEN_VISION.md",
  "ROVEN_ARCHITECTURE.md",
  "ROVEN_EXECUTION_SPEC.md",
  "ROVEN_V0_PLAN.md",
];
const markdownDocuments = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ...lifecycleDocuments,
  "docs/adr/0001-m0-contracts-and-data-defaults.md",
  "docs/adr/0002-safe-project-initialization.md",
  "docs/adr/0003-local-event-store-and-cas.md",
  "docs/adr/0004-project-storage-bootstrap.md",
  "docs/adr/0005-shared-context-and-role-handoff.md",
  "docs/adr/0006-deterministic-context-preparation.md",
  "docs/adr/0007-provider-neutral-context-delivery.md",
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

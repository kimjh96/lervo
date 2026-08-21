import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageFiles = [];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) packageFiles.push(resolve(root, parent, entry.name, "package.json"));
  }
}

const manifests = new Map();
for (const file of packageFiles) {
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifests.set(manifest.name, { file, dependencies: Object.keys(manifest.dependencies ?? {}) });
}

const failures = [];
const visiting = new Set();
const visited = new Set();
function visit(name, path = []) {
  if (visiting.has(name)) {
    failures.push(`production dependency cycle: ${[...path, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  const manifest = manifests.get(name);
  for (const dependency of manifest?.dependencies ?? []) {
    if (manifests.has(dependency)) visit(dependency, [...path, name]);
  }
  visiting.delete(name);
  visited.add(name);
}
for (const name of manifests.keys()) visit(name);

const forbidden = new Map([
  ["@lervo/conversation-deliberation-sqlite", new Set(["@lervo/conversation-control"])],
  ["@lervo/deliberation-runtime", new Set(["@lervo/orchestrator"])],
]);
for (const [name, dependencies] of forbidden) {
  const actual = manifests.get(name)?.dependencies ?? [];
  for (const dependency of dependencies) {
    if (actual.includes(dependency)) failures.push(`${name} must not depend on ${dependency}`);
  }
}

if (failures.length > 0) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`패키지 production 경계 검사 통과 (${manifests.size}개 package)`);
}

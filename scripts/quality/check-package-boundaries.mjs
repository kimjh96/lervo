import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const packageFiles = [];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) packageFiles.push(resolve(root, parent, entry.name, "package.json"));
  }
}

const manifests = new Map();
const failures = [];
for (const file of packageFiles) {
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifests.has(manifest.name)) failures.push(`duplicate package name: ${manifest.name}`);
  manifests.set(manifest.name, {
    file,
    layer: file.includes("/apps/") ? "app" : "package",
    dependencies: Object.keys(manifest.dependencies ?? {}),
  });
}

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

for (const [name, manifest] of manifests) {
  for (const dependency of manifest.dependencies) {
    const target = manifests.get(dependency);
    if (manifest.layer === "package" && target?.layer === "app") {
      failures.push(`${name} package must not depend on ${dependency} app`);
    }
    if (
      name.endsWith("-contract") &&
      target !== undefined &&
      dependency !== "@lervo/schemas" &&
      !dependency.endsWith("-contract")
    )
      failures.push(`${name} contract must not depend on ${dependency} implementation`);
  }
}

function dependsOn(name, target, seen = new Set()) {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  return (manifests.get(name)?.dependencies ?? [])
    .filter((dependency) => manifests.has(dependency))
    .some((dependency) => dependsOn(dependency, target, seen));
}

const forbidden = new Map([
  ["@lervo/conversation-deliberation-sqlite", new Set(["@lervo/conversation-control"])],
  ["@lervo/deliberation-runtime", new Set(["@lervo/orchestrator"])],
]);
for (const [name, dependencies] of forbidden) {
  for (const dependency of dependencies) {
    if (dependsOn(name, dependency)) {
      failures.push(`${name} must not transitively depend on ${dependency}`);
    }
  }
}

// ADE convention (ADR-0613): the desktop interface reaches Lervo only through the session-host
// protocol, so it depends on no other workspace package.
const adeAllowedWorkspaceDependencies = new Set(["@lervo/session-host-contract"]);
for (const dependency of manifests.get("@lervo/ade")?.dependencies ?? []) {
  if (manifests.has(dependency) && !adeAllowedWorkspaceDependencies.has(dependency)) {
    failures.push(
      `@lervo/ade must not depend on ${dependency}; it reaches Lervo through the session-host protocol`,
    );
  }
}

if (failures.length > 0) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Package production-boundary check passed (${manifests.size} packages)`);
}

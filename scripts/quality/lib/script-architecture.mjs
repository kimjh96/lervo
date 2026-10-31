import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import ts from "typescript";

const scriptDomains = new Set([
  "distribution",
  "evaluation",
  "foundation",
  "natural-language-evaluation",
  "quality",
  "release",
  "shared",
]);
const allowedDependencyEdges = new Set([
  "distribution->shared",
  "release->distribution",
  "release->shared",
]);
const evidenceBoundRootScripts = new Map();

function repositoryPath(repositoryRoot, path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function filesBelow(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function domainFor(path) {
  if (path.startsWith("scripts/natural-language-evaluation/") || evidenceBoundRootScripts.has(path))
    return "evaluation";
  return path.split("/")[1] ?? null;
}

function isTestPath(path) {
  return path.split("/").includes("test") || /\.test\.[cm]?[jt]s$/u.test(path);
}

function relativeModuleSpecifiers(path, content) {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers.filter((specifier) => /^\.\.?\//u.test(specifier));
}

function repositoryScriptReferences(path, content) {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const references = [];
  function visit(node) {
    if (ts.isStringLiteralLike(node)) {
      references.push(
        ...[...node.text.matchAll(/(?:^|\s)(scripts\/[^\s"']+\.mjs)(?=$|\s)/gu)].map(
          (match) => match[1],
        ),
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

function packageScriptEntrypoints(manifest) {
  return [
    ...new Set(
      Object.values(manifest.scripts ?? {}).flatMap((command) =>
        typeof command === "string"
          ? [...command.matchAll(/(?:^|\s)node\s+(scripts\/[^\s"']+\.mjs)/gu)].map(
              (match) => match[1],
            )
          : [],
      ),
    ),
  ].toSorted();
}

function isOwnedEntrypoint(path) {
  if (evidenceBoundRootScripts.has(path)) return true;
  if (/^scripts\/(?:distribution|evaluation|foundation|quality)\/[^/]+\.mjs$/u.test(path)) {
    return true;
  }
  return (
    /^scripts\/release\/commands\/[^/]+\.mjs$/u.test(path) ||
    /^scripts\/release\/first-publication\/[^/]+\/commands\/[^/]+\.mjs$/u.test(path)
  );
}

export async function inspectScriptArchitecture(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const scriptsRoot = resolve(repositoryRoot, "scripts");
  const issues = [];
  const files = await filesBelow(scriptsRoot);
  const scriptPaths = files.map((path) => repositoryPath(repositoryRoot, path));
  for (const path of scriptPaths) {
    const segments = path.split("/");
    if (segments.length === 2 && path !== "scripts/code-convention-reviews.json") {
      const expectedDigest = evidenceBoundRootScripts.get(path);
      if (expectedDigest === undefined) {
        issues.push(`${path} is an unowned root script artifact.`);
      } else if (sha256(await readFile(resolve(repositoryRoot, path))) !== expectedDigest) {
        issues.push(`${path} changed after its evidence-bound structural exception.`);
      }
      continue;
    }
    if (segments.length > 2 && !scriptDomains.has(segments[1])) {
      issues.push(`${path} is outside an owned script domain.`);
    }
  }

  const modules = scriptPaths.filter((path) => path.endsWith(".mjs"));
  const moduleSet = new Set(modules);
  const repositoryReferences = new Set();
  for (const source of modules) {
    const content = await readFile(resolve(repositoryRoot, source), "utf8");
    for (const specifier of relativeModuleSpecifiers(source, content)) {
      const target = repositoryPath(
        repositoryRoot,
        resolve(repositoryRoot, dirname(source), specifier),
      );
      if (!target.startsWith("scripts/") || !target.endsWith(".mjs")) continue;
      if (!moduleSet.has(target)) {
        issues.push(`${source} imports missing script module ${target}.`);
        continue;
      }
      if (!isTestPath(source) && isTestPath(target)) {
        issues.push(`${source} imports test-owned module ${target}.`);
      }
      const sourceDomain = domainFor(source);
      const targetDomain = domainFor(target);
      if (
        sourceDomain !== targetDomain &&
        !allowedDependencyEdges.has(`${sourceDomain}->${targetDomain}`)
      ) {
        issues.push(`${source} crosses the disallowed ${sourceDomain}->${targetDomain} boundary.`);
      }
    }
    if (!isTestPath(source)) {
      for (const target of repositoryScriptReferences(source, content)) {
        repositoryReferences.add(target);
        if (!moduleSet.has(target)) {
          issues.push(`${source} references missing repository script ${target}.`);
        }
      }
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  } catch {
    issues.push("package.json could not be read for script entrypoint validation.");
    manifest = {};
  }
  for (const path of packageScriptEntrypoints(manifest)) {
    let metadata;
    try {
      metadata = await lstat(resolve(repositoryRoot, path));
    } catch {
      issues.push(`package.json references missing script entrypoint ${path}.`);
      continue;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      issues.push(`package.json references unsafe script entrypoint ${path}.`);
    } else if (!isOwnedEntrypoint(path)) {
      issues.push(`package.json bypasses an owned script entrypoint with ${path}.`);
    }
  }

  return {
    schemaVersion: 1,
    moduleCount: modules.length,
    entrypointCount: packageScriptEntrypoints(manifest).length,
    repositoryReferenceCount: repositoryReferences.size,
    evidenceBoundExceptionCount: evidenceBoundRootScripts.size,
    issues: [...new Set(issues)].toSorted(),
  };
}

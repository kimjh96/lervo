import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { failNodeFleetApply } from "./node-fleet-apply-contract.js";

interface RuntimeDependencyFile {
  path: string;
  hash: string;
  executable: boolean;
}

interface RuntimeDependencyPackage {
  source: string;
  name: string;
  version: string;
  files: RuntimeDependencyFile[];
  dependencies: Record<string, number>;
}

export interface RuntimeDependencyClosure {
  packages: RuntimeDependencyPackage[];
  manifest: string;
  hash: string;
}

export function dependencyHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message: string): never {
  return failNodeFleetApply("node_fleet_executable_invalid", message);
}

async function resolvePackage(name: string, consumer: string): Promise<string | null> {
  if (!/^(@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/iu.test(name))
    fail("A runtime dependency package name is invalid.");
  for (const directory of createRequire(consumer).resolve.paths(name) ?? []) {
    try {
      return await realpath(resolve(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

/** Resolve npm and pnpm installations into a portable, bounded package graph. */
export async function describeRuntimeDependencies(
  consumer: string,
  packageName = "@anthropic-ai/claude-agent-sdk",
): Promise<RuntimeDependencyClosure> {
  const packages: RuntimeDependencyPackage[] = [];
  const seen = new Map<string, number>();
  let totalBytes = 0;
  let totalFiles = 0;
  const visit = async (source: string): Promise<number> => {
    const known = seen.get(source);
    if (known !== undefined) return known;
    if (packages.length >= 512) fail("The runtime dependency graph exceeds its package bound.");
    const manifestPath = resolve(source, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      name: string;
      version: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string")
      fail("A runtime dependency manifest has no package identity.");
    const index = packages.length;
    const entry: RuntimeDependencyPackage = {
      source,
      name: manifest.name,
      version: manifest.version,
      files: [],
      dependencies: {},
    };
    packages.push(entry);
    seen.set(source, index);
    const collect = async (relativeDirectory: string): Promise<void> => {
      const directory = resolve(source, relativeDirectory);
      const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name, "en"),
      );
      for (const child of children) {
        if (child.name === "node_modules") continue;
        const path = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
        if (child.isDirectory()) await collect(path);
        else if (child.isFile()) {
          const metadata = await stat(resolve(source, path));
          totalBytes += metadata.size;
          totalFiles += 1;
          if (totalBytes > 512 * 1024 * 1024 || totalFiles > 32_768)
            fail("The runtime dependency content exceeds its file or byte bound.");
          const bytes = await readFile(resolve(source, path));
          entry.files.push({
            path,
            hash: dependencyHash(bytes),
            executable: (metadata.mode & 0o111) !== 0,
          });
        } else fail("A runtime dependency contains an unsafe file.");
      }
    };
    await collect("");
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    for (const name of [...names].sort()) {
      const target = await resolvePackage(name, manifestPath);
      if (target === null) {
        if (
          name in (manifest.optionalDependencies ?? {}) ||
          manifest.peerDependenciesMeta?.[name]?.optional
        )
          continue;
        fail("A required runtime dependency is unavailable.");
      }
      entry.dependencies[name] = await visit(target);
      if (packages[entry.dependencies[name]]?.name !== name)
        fail("A runtime dependency resolved to a different package identity.");
    }
    return index;
  };
  const source = await resolvePackage(packageName, consumer);
  if (source === null) fail("The installed Node runtime dependency is unavailable.");
  await visit(source);
  if (packages[0]?.name !== packageName)
    fail("The runtime dependency resolved to a different package identity.");
  if (packageName === "@anthropic-ai/claude-agent-sdk") {
    const report = process.platform === "linux" ? process.report?.getReport() : null;
    const musl =
      report !== null &&
      typeof report === "object" &&
      !(report as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
    const nativeName = `${packageName}-${process.platform}-${process.arch}${musl ? "-musl" : ""}`;
    if (
      !packages.some((entry) => entry.name === nativeName && entry.version === packages[0]?.version)
    )
      fail("The installed Node runtime lacks the Claude SDK native dependency for this host.");
  }
  const manifest = `${JSON.stringify({ schemaVersion: 1, packages: packages.map(({ source: _source, ...entry }) => entry) })}\n`;
  return { packages, manifest, hash: dependencyHash(manifest) };
}

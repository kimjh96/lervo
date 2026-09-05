import { lstat, readdir, writeFile, mkdir, rename, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateSchema, type CapabilityLock } from "@lervo/schemas";

import { hashCapabilityPackageFiles, readCapabilityPackage } from "./package-reader.js";
import {
  CapabilityPackageError,
  type CapabilityResolution,
  type DiscoveredCapability,
  type LocalCapabilityScope,
  type ResolvedCapability,
  type ResolvedCapabilityPackage,
  type VerifiedCapabilityPackage,
} from "./types.js";

function compare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
export function compareCapabilityVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const withoutBuild = value.split("+", 1)[0]!;
    const [core, prerelease] = withoutBuild.split("-", 2);
    return { core: core!.split(".").map(Number), prerelease: prerelease?.split(".") };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference !== 0) return difference;
  }
  if (a.prerelease === undefined) return b.prerelease === undefined ? 0 : 1;
  if (b.prerelease === undefined) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/u.test(av);
    const bn = /^\d+$/u.test(bv);
    if (an && bn) return Number(av) - Number(bv);
    if (an !== bn) return an ? -1 : 1;
    return compare(av, bv);
  }
  return 0;
}
function key(id: string, version: string): string {
  return `${encodeURIComponent(id)}@${version}`;
}
function fail(code: CapabilityPackageError["code"], message: string, cause?: unknown): never {
  throw new CapabilityPackageError(code, message, cause === undefined ? undefined : { cause });
}

export function capabilityRoot(
  repositoryRoot: string,
  scope: LocalCapabilityScope,
  userRoot?: string,
): string {
  return scope === "project"
    ? resolve(repositoryRoot, ".lervo/capabilities/packages")
    : resolve(
        userRoot ??
          process.env.LERVO_USER_CAPABILITY_ROOT ??
          resolve(process.env.HOME ?? "", ".lervo/capabilities"),
        "packages",
      );
}

export async function discoverCapabilityRoot(
  root: string,
  sourceKind: LocalCapabilityScope,
): Promise<DiscoveredCapability[]> {
  let entries;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail("capability_unsafe_package", "A capability root must be a physical directory.");
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: DiscoveredCapability[] = [];
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const verified = await readCapabilityPackage(resolve(root, entry.name));
    if (entry.name !== key(verified.manifest.capabilityId, verified.manifest.version))
      fail(
        "capability_invalid",
        `Capability directory '${entry.name}' does not match its immutable coordinate.`,
      );
    result.push({ ...verified, source: { kind: sourceKind, uri: `${sourceKind}:${entry.name}` } });
  }
  return result;
}

function providerCompatible(candidate: DiscoveredCapability, provider: string): boolean {
  const contract = candidate.manifest.compatibility.providers;
  return contract.mode === "any" || contract.providers.includes(provider as never);
}

export async function resolveCapabilities(input: {
  repositoryRoot: string;
  projectId: string;
  capabilityIds: readonly string[];
  provider: string;
  platform: NodeJS.Platform;
  generatedAt: string;
  userRoot?: string;
  allowedPermissions?: readonly string[];
}): Promise<CapabilityResolution> {
  const requested = [...new Set(input.capabilityIds)].sort();
  if (
    requested.length > 64 ||
    requested.some((id) => !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u.test(id) || id.length > 150)
  )
    fail("capability_invalid", "A requested capability ID is invalid.");
  const candidates = [
    ...(await discoverCapabilityRoot(capabilityRoot(input.repositoryRoot, "project"), "project")),
    ...(await discoverCapabilityRoot(
      capabilityRoot(input.repositoryRoot, "user", input.userRoot),
      "user",
    )),
  ];
  const selected = new Map<string, ResolvedCapability>();
  const activationPackages = new Map<string, ResolvedCapabilityPackage>();
  const resolving = new Set<string>();
  const resolveOne = (
    capabilityId: string,
    coordinate?: { version: string; contentHash: string },
  ): void => {
    const already = selected.get(capabilityId);
    if (already !== undefined) {
      if (
        coordinate !== undefined &&
        (already.version !== coordinate.version || already.contentHash !== coordinate.contentHash)
      )
        fail(
          "capability_conflict",
          `Capability '${capabilityId}' has conflicting dependency coordinates.`,
        );
      return;
    }
    if (resolving.has(capabilityId) || resolving.size >= 64)
      fail(
        "capability_conflict",
        `Capability '${capabilityId}' has cyclic or over-deep dependencies.`,
      );
    const compatible = candidates.filter(
      (item) =>
        item.manifest.capabilityId === capabilityId &&
        providerCompatible(item, input.provider) &&
        item.manifest.compatibility.platforms.includes(input.platform as never),
    );
    compatible.sort((a, b) =>
      a.source.kind === b.source.kind
        ? compareCapabilityVersions(b.manifest.version, a.manifest.version)
        : a.source.kind === "project"
          ? -1
          : 1,
    );
    const candidate =
      coordinate === undefined
        ? compatible[0]
        : compatible.find(
            (item) =>
              item.manifest.version === coordinate.version &&
              item.manifest.contentHash === coordinate.contentHash,
          );
    if (candidate === undefined)
      fail(
        "capability_not_found",
        `No compatible package resolved capability '${capabilityId}'${coordinate === undefined ? "" : " at its exact dependency coordinate"}.`,
      );
    if (
      input.allowedPermissions !== undefined &&
      candidate.manifest.requiredPermissions.some(
        (permission) => !input.allowedPermissions!.includes(permission),
      )
    )
      fail(
        "capability_unsupported",
        `Capability '${capabilityId}' requires permission not allowed by the role.`,
      );
    resolving.add(capabilityId);
    try {
      for (const dependency of candidate.manifest.dependencies)
        resolveOne(dependency.capabilityId, dependency);
      if (candidate.manifest.entrypoint.kind === "bundle")
        for (const member of candidate.manifest.entrypoint.members)
          resolveOne(member.capabilityId, member);
    } finally {
      resolving.delete(capabilityId);
    }
    selected.set(capabilityId, {
      capabilityId,
      kind: candidate.manifest.kind,
      version: candidate.manifest.version,
      contentHash: candidate.manifest.contentHash,
      sourceKind: candidate.source.kind,
      sourceUri: candidate.source.uri,
      activationStatus: "resolved",
      entrypoint: structuredClone(candidate.manifest.entrypoint),
      requiredPermissions: [...candidate.manifest.requiredPermissions],
    });
    activationPackages.set(capabilityId, {
      manifest: structuredClone(candidate.manifest),
      directoryPath: candidate.directoryPath,
      files: candidate.files.map((file) => ({
        path: file.path,
        bytes: new Uint8Array(file.bytes),
      })),
      sourceKind: candidate.source.kind,
    });
  };
  for (const capabilityId of requested) resolveOne(capabilityId);
  const values = [...selected.values()].sort((a, b) => compare(a.capabilityId, b.capabilityId));
  const lock: CapabilityLock = {
    schemaVersion: 1,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    entries: values.map((item) => ({
      capabilityId: item.capabilityId,
      kind: item.kind,
      version: item.version,
      contentHash: item.contentHash,
      source: { kind: item.sourceKind, uri: item.sourceUri },
      activationStatus: "resolved",
    })),
  };
  if (!validateSchema("capabilityLock", lock).valid)
    fail("capability_invalid", "The resolved capability lock is invalid.");
  return {
    selected: values,
    activationPackages: values.map((item) => activationPackages.get(item.capabilityId)!),
    lock,
  };
}

export async function writeCapabilityLock(
  repositoryRoot: string,
  lock: CapabilityLock,
): Promise<void> {
  const path = resolve(repositoryRoot, ".lervo/capabilities.lock");
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    fail("capability_write_failed", "The capability lock could not be written atomically.", error);
  }
}

async function writeVerifiedPackage(
  target: string,
  packageValue: VerifiedCapabilityPackage,
): Promise<void> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = resolve(parent, `.install-${process.pid}-${Date.now()}`);
  try {
    await mkdir(temporary, { mode: 0o700 });
    for (const file of packageValue.files) {
      const path = resolve(temporary, file.path);
      if (!path.startsWith(`${temporary}/`))
        fail("capability_unsafe_package", "A package output path escaped the installation root.");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(file.bytes);
      } finally {
        await handle.close();
      }
    }
    await rename(temporary, target);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST" ||
      (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
    )
      fail("capability_conflict", "A package already exists at this immutable coordinate.", error);
    if (error instanceof CapabilityPackageError) throw error;
    fail(
      "capability_write_failed",
      "The capability package could not be installed atomically.",
      error,
    );
  }
}

export async function installCapabilityPackage(input: {
  repositoryRoot: string;
  scope: LocalCapabilityScope;
  package: VerifiedCapabilityPackage;
  userRoot?: string;
}): Promise<string> {
  const root = capabilityRoot(input.repositoryRoot, input.scope, input.userRoot);
  const target = resolve(
    root,
    key(input.package.manifest.capabilityId, input.package.manifest.version),
  );
  try {
    const existing = await readCapabilityPackage(target);
    if (
      hashCapabilityPackageFiles(existing.files) === hashCapabilityPackageFiles(input.package.files)
    )
      return target;
    fail("capability_conflict", "A different package already occupies this capability coordinate.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeVerifiedPackage(target, input.package);
  return target;
}

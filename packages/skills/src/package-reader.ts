import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import { validateSchema, type SkillManifest } from "@lervo/schemas";

import { hashSkillContentFiles } from "./content-hash.js";
import {
  sameFileAcrossStatSurfaces,
  sameFileWithinStatSurface,
} from "./stable-file-observation.js";
import { SkillResolutionError, type DiscoveredSkill, type LocalSkillSourceKind } from "./types.js";

const MANIFEST_NAME = "lervo-skill.json";
const MAX_PACKAGE_FILES = 256;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function assertWithin(root: string, path: string): void {
  const child = relative(root, path);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`)) {
    throw new SkillResolutionError(
      "unsafe_skill_package",
      "The skill package path points outside the discovery root.",
    );
  }
}

async function regularFile(path: string, maximumBytes = MAX_PACKAGE_BYTES): Promise<Uint8Array> {
  const beforePath = await lstat(path);
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.size > maximumBytes) {
    throw new SkillResolutionError(
      "unsafe_skill_package",
      "A skill package file must be a regular file within the size limit.",
    );
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedHandle = await handle.stat();
    const afterOpenPath = await lstat(path);
    if (
      !openedHandle.isFile() ||
      openedHandle.size > maximumBytes ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenPath.size > maximumBytes ||
      !sameFileWithinStatSurface(beforePath, afterOpenPath) ||
      !sameFileAcrossStatSurfaces(afterOpenPath, openedHandle)
    ) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "The skill package file path changed before it was read.",
      );
    }
    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat();
    const afterReadPath = await lstat(path);
    if (
      !afterReadHandle.isFile() ||
      afterReadHandle.size > maximumBytes ||
      !afterReadPath.isFile() ||
      afterReadPath.isSymbolicLink() ||
      afterReadPath.size > maximumBytes ||
      !sameFileWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameFileWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameFileAcrossStatSurfaces(afterReadPath, afterReadHandle)
    ) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "The skill package file changed while it was being read.",
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof SkillResolutionError) throw error;
    throw new SkillResolutionError(
      "unsafe_skill_package",
      "The skill package file cannot be opened safely.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function listContentFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = resolve(current, entry.name);
    assertWithin(root, path);
    if (entry.isSymbolicLink()) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "Symbolic links are not allowed inside a skill package.",
      );
    }
    if (entry.isDirectory()) files.push(...(await listContentFiles(root, path)));
    else if (
      entry.isFile() &&
      ![MANIFEST_NAME, "lervo-capability.json"].includes(relative(root, path))
    )
      files.push(path);
    else if (!entry.isFile()) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "A skill package may contain only regular files and directories.",
      );
    }
    if (files.length > MAX_PACKAGE_FILES) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "The skill package file-count limit has been exceeded.",
      );
    }
  }
  return files;
}

export async function hashSkillPackageProjection(
  directoryPath: string,
  overrides: ReadonlyMap<string, Uint8Array>,
): Promise<string> {
  const files = await listContentFiles(directoryPath);
  const projected = new Map(
    await Promise.all(
      files.map(
        async (path) =>
          [portablePath(relative(directoryPath, path)), await regularFile(path)] as const,
      ),
    ),
  );
  for (const [path, bytes] of overrides) {
    if ([MANIFEST_NAME, "lervo-capability.json"].includes(path)) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "Skill package content projections cannot replace package manifests.",
      );
    }
    projected.set(path, bytes);
  }
  return hashSkillContentFiles([...projected].map(([path, bytes]) => ({ path, bytes })));
}

export async function hashSkillPackage(directoryPath: string): Promise<string> {
  return hashSkillPackageProjection(directoryPath, new Map());
}

async function readCandidate(input: {
  directoryPath: string;
  sourceKind: LocalSkillSourceKind;
  sourceUri: string;
  requestedSkillIds?: ReadonlySet<string>;
}): Promise<DiscoveredSkill | null> {
  const manifestPath = resolve(input.directoryPath, MANIFEST_NAME);
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await regularFile(manifestPath, MAX_MANIFEST_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch (error) {
    throw new SkillResolutionError(
      "invalid_skill_manifest",
      "lervo-skill.json cannot be read as UTF-8 JSON.",
      { cause: error },
    );
  }
  const rawSkillId = (manifest as { skillId?: unknown } | null)?.skillId;
  if (
    input.requestedSkillIds !== undefined &&
    (typeof rawSkillId !== "string" || !input.requestedSkillIds.has(rawSkillId))
  )
    return null;
  if (!validateSchema("skill", manifest).valid) {
    throw new SkillResolutionError(
      "invalid_skill_manifest",
      "lervo-skill.json does not satisfy the skill manifest contract.",
    );
  }
  const typedManifest = manifest as SkillManifest;
  if (
    typedManifest.source.kind !== input.sourceKind &&
    !["organization", "external"].includes(typedManifest.source.kind)
  ) {
    throw new SkillResolutionError(
      "invalid_skill_manifest",
      "The skill manifest source kind differs from its actual discovery location.",
    );
  }
  const actualHash = await hashSkillPackage(input.directoryPath);
  if (actualHash !== typedManifest.contentHash) {
    throw new SkillResolutionError(
      "content_hash_mismatch",
      "The skill manifest content hash differs from the actual package.",
    );
  }
  const finalManifestBytes = await regularFile(manifestPath, MAX_MANIFEST_BYTES);
  if (!Buffer.from(finalManifestBytes).equals(Buffer.from(manifestBytes))) {
    throw new SkillResolutionError(
      "unsafe_skill_package",
      "The skill manifest changed while the package was being verified.",
    );
  }
  return {
    manifest: structuredClone(typedManifest),
    directoryPath: input.directoryPath,
    source: { kind: input.sourceKind, uri: input.sourceUri },
  };
}

export async function discoverSkillRoot(input: {
  root: string;
  sourceKind: LocalSkillSourceKind;
  sourceUriPrefix: string;
  requestedSkillIds?: readonly string[];
}): Promise<DiscoveredSkill[]> {
  let entries;
  try {
    const rootStat = await lstat(input.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new SkillResolutionError(
        "unsafe_skill_package",
        "A skill discovery root must be a directory, not a symbolic link.",
      );
    }
    entries = await readdir(input.root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const candidates: DiscoveredSkill[] = [];
  const requestedSkillIds =
    input.requestedSkillIds === undefined ? undefined : new Set(input.requestedSkillIds);
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directoryPath = resolve(input.root, entry.name);
    assertWithin(input.root, directoryPath);
    const candidate = await readCandidate({
      directoryPath,
      sourceKind: input.sourceKind,
      sourceUri: `${input.sourceUriPrefix}/${basename(directoryPath)}`,
      ...(requestedSkillIds === undefined ? {} : { requestedSkillIds }),
    });
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}

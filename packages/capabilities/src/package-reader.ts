import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { validateSchema, type CapabilityPackageManifest } from "@lervo/schemas";

import {
  CapabilityPackageError,
  type CapabilityPackageFile,
  type VerifiedCapabilityPackage,
} from "./types.js";
import { createCapabilityActivationRequests } from "./activation.js";

export const CAPABILITY_MANIFEST = "lervo-capability.json";
const MAX_FILES = 256;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const DENIED_NAMES =
  /(?:^|\/)(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?\.json|secrets?\.(?:json|ya?ml)|.*\.(?:p12|pfx|pem|key))$/iu;

export function isSafeCapabilityContentPath(value: string): boolean {
  const parts = value.split("/");
  const nativePluginMetadata =
    (parts[0] === ".codex-plugin" || parts[0] === ".claude-plugin") &&
    parts.length === 2 &&
    parts[1] === "plugin.json";
  return (
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith("/") &&
    (nativePluginMetadata ||
      !parts.some((part) => part === "" || part === ".." || part.startsWith("."))) &&
    !DENIED_NAMES.test(value)
  );
}

function portable(value: string): string {
  return value.split(sep).join("/");
}
function compare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function fail(code: CapabilityPackageError["code"], message: string, cause?: unknown): never {
  throw new CapabilityPackageError(code, message, cause === undefined ? undefined : { cause });
}

function within(root: string, path: string): void {
  const child = relative(root, path);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`))
    fail("capability_unsafe_package", "A capability path escaped its package root.");
}

async function regularFile(path: string, maximumBytes = MAX_TOTAL_BYTES): Promise<Uint8Array> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes)
    fail(
      "capability_unsafe_package",
      "Capability packages may contain only bounded regular files.",
    );
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (before.dev !== opened.dev || before.ino !== opened.ino)
      fail("capability_unsafe_package", "A capability file changed before it was read.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      fail("capability_unsafe_package", "A capability file changed while it was read.");
    return bytes;
  } catch (error) {
    if (error instanceof CapabilityPackageError) throw error;
    return fail(
      "capability_unsafe_package",
      "A capability file could not be opened safely.",
      error,
    );
  } finally {
    await handle?.close();
  }
}

async function collect(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    const path = resolve(current, entry.name);
    within(root, path);
    if (entry.isSymbolicLink())
      fail("capability_unsafe_package", "Symbolic links are not allowed in a capability package.");
    if (entry.isDirectory()) files.push(...(await collect(root, path)));
    else if (entry.isFile()) files.push(path);
    else
      fail(
        "capability_unsafe_package",
        "Unsupported filesystem entries are not allowed in a capability package.",
      );
    if (files.length > MAX_FILES + 1)
      fail("capability_unsafe_package", "The capability package file limit was exceeded.");
  }
  return files;
}

export function hashCapabilityFiles(files: readonly CapabilityPackageFile[]): string {
  const hash = createHash("sha256");
  let total = 0;
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    if (file.path === CAPABILITY_MANIFEST || file.path === "lervo-skill.json") continue;
    total += file.bytes.byteLength;
    if (total > MAX_TOTAL_BYTES)
      fail("capability_unsafe_package", "The capability package size limit was exceeded.");
    hash.update(`${Buffer.byteLength(file.path)}:${file.path}:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function readCapabilityContentFiles(
  directoryPath: string,
): Promise<CapabilityPackageFile[]> {
  const info = await lstat(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink())
    fail("capability_unsafe_package", "A capability source root must be a physical directory.");
  const files: CapabilityPackageFile[] = [];
  for (const path of await collect(directoryPath)) {
    const relativePath = portable(relative(directoryPath, path));
    if (relativePath === CAPABILITY_MANIFEST) continue;
    if (!isSafeCapabilityContentPath(relativePath))
      fail(
        "capability_unsafe_package",
        `Capability package file '${relativePath}' is not publishable or installable.`,
      );
    files.push({ path: relativePath, bytes: await regularFile(path) });
  }
  return files;
}

export async function readCapabilityPackage(
  directoryPath: string,
): Promise<VerifiedCapabilityPackage> {
  const info = await lstat(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink())
    fail("capability_unsafe_package", "A capability package root must be a physical directory.");
  const paths = await collect(directoryPath);
  const manifestPath = resolve(directoryPath, CAPABILITY_MANIFEST);
  if (!paths.includes(manifestPath))
    fail("capability_invalid", `The package is missing ${CAPABILITY_MANIFEST}.`);
  const files: CapabilityPackageFile[] = [];
  for (const path of paths) {
    const relativePath = portable(relative(directoryPath, path));
    if (relativePath !== CAPABILITY_MANIFEST && !isSafeCapabilityContentPath(relativePath))
      fail(
        "capability_unsafe_package",
        `Capability package file '${relativePath}' is not publishable or installable.`,
      );
    files.push({
      path: relativePath,
      bytes: await regularFile(
        path,
        relativePath === CAPABILITY_MANIFEST ? MAX_MANIFEST_BYTES : MAX_TOTAL_BYTES,
      ),
    });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        files.find((file) => file.path === CAPABILITY_MANIFEST)!.bytes,
      ),
    );
  } catch (error) {
    fail("capability_invalid", `${CAPABILITY_MANIFEST} is not valid UTF-8 JSON.`, error);
  }
  if (!validateSchema("capabilityPackageManifest", manifest).valid)
    fail("capability_invalid", `${CAPABILITY_MANIFEST} does not satisfy the v1 contract.`);
  const typed = manifest as CapabilityPackageManifest;
  if (typed.kind !== typed.entrypoint.kind)
    fail("capability_invalid", "The package kind and entrypoint kind differ.");
  const actual = hashCapabilityFiles(files);
  if (actual !== typed.contentHash)
    fail(
      "capability_content_hash_mismatch",
      "The capability manifest hash differs from the verified package content.",
    );
  if (typed.entrypoint.kind === "skill") {
    const entrypoint = typed.entrypoint;
    const skillFile = files.find((file) => file.path === entrypoint.manifestPath);
    let skill: unknown;
    try {
      skill =
        skillFile === undefined
          ? null
          : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(skillFile.bytes));
    } catch {
      skill = null;
    }
    if (
      !validateSchema("skill", skill).valid ||
      (skill as { skillId?: unknown }).skillId !== entrypoint.skillId ||
      (skill as { contentHash?: unknown }).contentHash !== actual
    )
      fail(
        "capability_invalid",
        "A skill capability must contain a matching, independently valid lervo-skill.json contract.",
      );
  }
  if (typed.entrypoint.kind === "provider_plugin") {
    const entrypoint = typed.entrypoint;
    if (!files.some((file) => file.path === entrypoint.pluginManifestPath))
      fail("capability_invalid", "The provider plugin manifest path is missing from the package.");
  }
  const verified = {
    manifest: structuredClone(typed),
    directoryPath,
    files: files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) })),
  };
  if (typed.kind === "mcp_server" || typed.kind === "provider_plugin") {
    createCapabilityActivationRequests([{ ...verified, sourceKind: "project" }]);
  }
  return verified;
}

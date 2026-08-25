import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { CapabilityPackageEnvelope } from "./envelope.js";
import { decodeCapabilityPackage } from "./envelope.js";
import { CapabilityPackageError } from "./types.js";

export type CapabilityPublicationScope =
  { kind: "project"; destinationId: string; projectId: string } | { kind: "public" };

export interface PublishedCapabilityPackage {
  schemaVersion: 1;
  scope: CapabilityPublicationScope;
  publisherPrincipalId: string;
  publishedAt: string;
  structure: CapabilityPublicationStructure;
  package: CapabilityPackageEnvelope;
}

export interface CapabilityPublicationStructure {
  contentClass: "capability_package";
  capabilityKind: "skill" | "mcp_server" | "provider_plugin" | "bundle";
  manifestSchemaVersion: 1;
  fileCount: number;
  totalBytes: number;
  secretMaterial: "excluded";
}

export function capabilityPublicationStructure(
  value: CapabilityPackageEnvelope,
): CapabilityPublicationStructure {
  const verified = decodeCapabilityPackage(value);
  return {
    contentClass: "capability_package",
    capabilityKind: verified.manifest.kind,
    manifestSchemaVersion: 1,
    fileCount: value.files.length,
    totalBytes: value.files.reduce(
      (total, file) => total + Buffer.from(file.contentBase64, "base64").byteLength,
      0,
    ),
    secretMaterial: "excluded",
  };
}

export interface CapabilityRegistry {
  put(value: PublishedCapabilityPackage): Promise<"created" | "present">;
  get(
    scope: CapabilityPublicationScope,
    capabilityId: string,
    version: string,
  ): Promise<PublishedCapabilityPackage | null>;
}

function segment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/u.test(value))
    throw new CapabilityPackageError(
      "capability_invalid",
      "A Hub capability coordinate is invalid.",
    );
  return value;
}

function packageSegment(id: string, version: string): string {
  if (
    !/^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u.test(id) ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      version,
    )
  )
    throw new CapabilityPackageError("capability_invalid", "A Hub package coordinate is invalid.");
  return `${encodeURIComponent(id)}@${version}.json`;
}

function recordPath(
  root: string,
  scope: CapabilityPublicationScope,
  id: string,
  version: string,
): string {
  const base =
    scope.kind === "public"
      ? resolve(root, "public")
      : resolve(root, "projects", segment(scope.destinationId), segment(scope.projectId));
  const shard = createHash("sha256").update(id).digest("hex").slice(0, 2);
  return resolve(base, shard, packageSegment(id, version));
}

function legacyRecordPath(
  root: string,
  scope: CapabilityPublicationScope,
  id: string,
  version: string,
): string {
  const base =
    scope.kind === "public"
      ? resolve(root, "public")
      : resolve(root, "projects", segment(scope.destinationId), segment(scope.projectId));
  return resolve(base, packageSegment(id, version));
}

function validPublished(value: unknown): value is PublishedCapabilityPackage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as PublishedCapabilityPackage;
  if (
    item.schemaVersion !== 1 ||
    typeof item.publisherPrincipalId !== "string" ||
    typeof item.publishedAt !== "string" ||
    Number.isNaN(Date.parse(item.publishedAt)) ||
    item.scope === null ||
    typeof item.scope !== "object"
  )
    return false;
  try {
    const structure = capabilityPublicationStructure(item.package);
    return (
      JSON.stringify(item.structure) === JSON.stringify(structure) &&
      (item.scope.kind === "public" ||
        (item.scope.kind === "project" &&
          typeof item.scope.destinationId === "string" &&
          typeof item.scope.projectId === "string"))
    );
  } catch {
    return false;
  }
}

export class FileSystemCapabilityRegistry implements CapabilityRegistry {
  constructor(readonly root: string) {}

  async put(value: PublishedCapabilityPackage): Promise<"created" | "present"> {
    const verified = decodeCapabilityPackage(value.package);
    if (!validPublished(value))
      throw new CapabilityPackageError(
        "capability_invalid",
        "The Hub capability publication structure is invalid.",
      );
    const path = recordPath(
      this.root,
      value.scope,
      verified.manifest.capabilityId,
      verified.manifest.version,
    );
    const record = resolve(path, "record.json");
    const encoded = `${JSON.stringify(value)}\n`;
    try {
      const current = await readFile(record, "utf8");
      const parsed = JSON.parse(current) as PublishedCapabilityPackage;
      if (
        validPublished(parsed) &&
        JSON.stringify(parsed.scope) === JSON.stringify(value.scope) &&
        JSON.stringify(parsed.package) === JSON.stringify(value.package)
      )
        return "present";
      throw new CapabilityPackageError(
        "capability_conflict",
        "A different package already occupies the Hub coordinate.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await mkdir(temporary, { mode: 0o700 });
    const handle = await open(resolve(temporary, "record.json"), "wx", 0o600);
    try {
      await handle.writeFile(encoded);
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" ||
        (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
      )
        return this.put(value);
      throw error;
    }
    return "created";
  }

  async get(
    scope: CapabilityPublicationScope,
    capabilityId: string,
    version: string,
  ): Promise<PublishedCapabilityPackage | null> {
    for (const path of [
      recordPath(this.root, scope, capabilityId, version),
      legacyRecordPath(this.root, scope, capabilityId, version),
    ]) {
      try {
        const value: unknown = JSON.parse(await readFile(resolve(path, "record.json"), "utf8"));
        if (!validPublished(value))
          throw new CapabilityPackageError(
            "capability_invalid",
            "The Hub capability record is invalid.",
          );
        return structuredClone(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return null;
  }
}

export class MemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly values = new Map<string, PublishedCapabilityPackage>();
  private key(scope: CapabilityPublicationScope, id: string, version: string): string {
    return JSON.stringify([scope, id, version]);
  }
  async put(value: PublishedCapabilityPackage): Promise<"created" | "present"> {
    if (!validPublished(value))
      throw new CapabilityPackageError(
        "capability_invalid",
        "The Hub capability publication structure is invalid.",
      );
    const manifest = decodeCapabilityPackage(value.package).manifest;
    const key = this.key(value.scope, manifest.capabilityId, manifest.version);
    const current = this.values.get(key);
    if (current !== undefined) {
      if (
        JSON.stringify(current.scope) === JSON.stringify(value.scope) &&
        JSON.stringify(current.package) === JSON.stringify(value.package)
      )
        return "present";
      throw new CapabilityPackageError(
        "capability_conflict",
        "A different package already occupies the Hub coordinate.",
      );
    }
    this.values.set(key, structuredClone(value));
    return "created";
  }
  async get(
    scope: CapabilityPublicationScope,
    id: string,
    version: string,
  ): Promise<PublishedCapabilityPackage | null> {
    return structuredClone(this.values.get(this.key(scope, id, version)) ?? null);
  }
}

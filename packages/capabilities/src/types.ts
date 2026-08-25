import type { CapabilityLock, CapabilityPackageManifest } from "@lervo/schemas";

export type LocalCapabilityScope = "project" | "user";

export interface CapabilityPackageFile {
  path: string;
  bytes: Uint8Array;
}

export interface VerifiedCapabilityPackage {
  manifest: CapabilityPackageManifest;
  directoryPath: string;
  files: CapabilityPackageFile[];
}

export interface DiscoveredCapability extends VerifiedCapabilityPackage {
  source: { kind: LocalCapabilityScope; uri: string };
}

export interface ResolvedCapability {
  capabilityId: string;
  kind: CapabilityPackageManifest["kind"];
  version: string;
  contentHash: string;
  sourceKind: LocalCapabilityScope;
  sourceUri: string;
  activationStatus: "resolved";
  entrypoint: CapabilityPackageManifest["entrypoint"];
  requiredPermissions: string[];
}

export interface CapabilityResolution {
  selected: ResolvedCapability[];
  activationPackages: ResolvedCapabilityPackage[];
  lock: CapabilityLock;
}

export interface CapabilityRecommendation {
  capabilityId: string;
  kind: CapabilityPackageManifest["kind"];
  version: string;
  contentHash: string;
  score: number;
  reasonCodes: Array<"intent_phrase" | "keyword" | "identity_token">;
}

export interface ResolvedCapabilityPackage extends VerifiedCapabilityPackage {
  sourceKind: LocalCapabilityScope;
}

export class CapabilityPackageError extends Error {
  constructor(
    readonly code:
      | "capability_approval_mismatch"
      | "capability_conflict"
      | "capability_content_hash_mismatch"
      | "capability_hub_failed"
      | "capability_invalid"
      | "capability_not_found"
      | "capability_unsafe_package"
      | "capability_unsupported"
      | "capability_write_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CapabilityPackageError";
  }
}

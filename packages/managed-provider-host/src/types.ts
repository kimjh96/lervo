import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { ManagedCapabilityApprovalVerifier } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import type { RemoteCommandExecutor } from "@lervo/remote-command";
import type { DocumentRegistry, RemoteCommandTarget } from "@lervo/schemas";

import type { PreparedManagedProviderHostVerification } from "./verification.js";
import type { ManagedProviderHostRoleRegistry } from "./role-registry.js";
import type { resolveManagedProviderHostSkills } from "./skills.js";

export interface ManagedProviderHostAdapterFactory {
  create(input: {
    provider: string;
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
  }): ProviderAdapter | null;
}

export interface ManagedProviderHostOptions {
  repositoryRoot: string;
  target: RemoteCommandTarget;
  providers: readonly string[];
  roles: readonly string[];
  roleRegistry: ManagedProviderHostRoleRegistry;
  adapterFactory: ManagedProviderHostAdapterFactory;
  approvalVerifier: ManagedCapabilityApprovalVerifier;
  now?: () => Date;
  createId?: (prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn") => string;
  openStorage?: (root: string) => Promise<ProjectStorage>;
  loadRegistry?: (root: string) => Promise<DocumentRegistry>;
  resolveSkills?: typeof resolveManagedProviderHostSkills;
  userSkillRoot?: string;
  prepareVerification?: (input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    now?: () => Date;
  }) => Promise<PreparedManagedProviderHostVerification>;
}

export interface ManagedProviderHost extends RemoteCommandExecutor {}

export type ManagedProviderHostErrorCode =
  | "host_configuration_invalid"
  | "managed_command_unsupported"
  | "managed_approval_scope_invalid"
  | "managed_project_mismatch"
  | "managed_execution_failed"
  | "managed_cleanup_failed";

export class ManagedProviderHostError extends Error {
  constructor(
    readonly code: ManagedProviderHostErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedProviderHostError";
  }
}

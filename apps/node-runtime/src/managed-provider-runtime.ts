import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import {
  ManagedProviderHostRoleRegistry,
  ManagedRemoteProviderHost,
  type ManagedProviderHostAdapterFactory,
} from "@lervo/managed-provider-host";
import type { RoleProfile } from "@lervo/schemas";

import type { NodeRuntimeConfig } from "./config-types.js";
import type { NodeRemoteCommandPorts } from "./control-runtime.js";
import { NodeRuntimeError } from "./errors.js";

export interface ManagedProviderRemoteCommandDependencies {
  createAdapter?: ManagedProviderHostAdapterFactory["create"];
  roleProfiles?: readonly RoleProfile[];
}

export function createManagedProviderRemoteCommandPorts(
  config: NodeRuntimeConfig,
  dependencies: ManagedProviderRemoteCommandDependencies = {},
): NodeRemoteCommandPorts | undefined {
  const providerHost = config.remoteCommands?.providerHost;
  if (providerHost === undefined) return undefined;
  const providers = new Set(providerHost.providers);
  const roleRegistry = new ManagedProviderHostRoleRegistry(
    dependencies.roleProfiles,
    providerHost.developerSkills,
  );
  const registeredRoleIds = new Set(roleRegistry.roleIds());
  if (providerHost.roles.some((roleId) => !registeredRoleIds.has(roleId))) {
    throw new NodeRuntimeError(
      "invalid_config",
      "A role is not included in the managed provider host role allowlist.",
    );
  }
  const roles = new Set(providerHost.roles);
  if (providerHost.developerSkills.length > 0 && !roles.has("developer")) {
    throw new NodeRuntimeError(
      "invalid_config",
      "developerSkills requires the developer role allowlist.",
    );
  }
  return {
    localPolicy: {
      async resolve(command) {
        if (
          !roles.has(command.action.roleId) ||
          !providers.has(command.action.provider as "codex" | "claude") ||
          roleRegistry.resolve(
            command.action.roleId,
            command.action.verificationSuiteIds,
          ) === null
        ) {
          return [{ capability: "filesystem.write", decision: "deny" }];
        }
        return [
          { capability: "filesystem.read", decision: "allow" },
          { capability: "filesystem.write", decision: "require_approval" },
          { capability: "shell.execute", decision: "allow" },
        ];
      },
    },
    createExecutor: ({ target, approvalVerifier }) => new ManagedRemoteProviderHost({
      repositoryRoot: config.repositoryRoot,
      target,
      providers: providerHost.providers,
      roles: providerHost.roles,
      roleRegistry,
      approvalVerifier,
      adapterFactory: {
        create: ({ provider, repositoryRoot, resolveArtifact }) => {
          if (!providers.has(provider as "codex" | "claude")) return null;
          if (dependencies.createAdapter !== undefined) {
            return dependencies.createAdapter({ provider, repositoryRoot, resolveArtifact });
          }
          return provider === "codex"
            ? new CodexAdapter({ repositoryRoot, resolveArtifact })
            : new ClaudeAdapter({ repositoryRoot, resolveArtifact });
        },
      },
    }),
  };
}

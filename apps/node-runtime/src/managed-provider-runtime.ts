import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import {
  ManagedProviderHostRoleRegistry,
  ManagedRemoteProviderHost,
  type ManagedProviderHostAdapterFactory,
} from "@lervo/managed-provider-host";
import type { RoleProfile } from "@lervo/schemas";
import type { ProviderAdapter, ProviderLoginContext } from "@lervo/adapter-contract";

import type { NodeRuntimeConfig } from "./config-types.js";
import type { NodeRemoteCommandPorts } from "./control-runtime.js";
import { NodeRuntimeError } from "./errors.js";
import { nodeRouteForProvider } from "./node-model-route.js";
import type { ProviderOutputSchema } from "@lervo/schemas";

export interface ManagedProviderRemoteCommandDependencies {
  createAdapter?: ManagedProviderHostAdapterFactory["create"];
  roleProfiles?: readonly RoleProfile[];
}

export function createNodeProviderAdapter(input: {
  loginContext?: ProviderLoginContext;
  provider: "codex" | "claude";
  repositoryRoot: string;
  resolveArtifact: (uri: string) => Promise<Uint8Array>;
  executable?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  requestTimeoutMs?: number;
  structuredOutputSchema?: ProviderOutputSchema;
}): ProviderAdapter {
  return input.provider === "codex"
    ? new CodexAdapter({
        ...(input.loginContext === undefined ? {} : { loginContext: input.loginContext }),
        repositoryRoot: input.repositoryRoot,
        resolveArtifact: input.resolveArtifact,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        ...(input.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: input.requestTimeoutMs }),
        ...(input.structuredOutputSchema === undefined
          ? {}
          : { structuredOutputSchema: input.structuredOutputSchema }),
      })
    : new ClaudeAdapter({
        ...(input.loginContext === undefined ? {} : { loginContext: input.loginContext }),
        repositoryRoot: input.repositoryRoot,
        resolveArtifact: input.resolveArtifact,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        ...(input.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: input.requestTimeoutMs }),
        ...(input.structuredOutputSchema === undefined
          ? {}
          : { structuredOutputSchema: input.structuredOutputSchema }),
      });
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
          roleRegistry.resolve(command.action.roleId, command.action.verificationSuiteIds) === null
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
    createExecutor: ({ target, approvalVerifier }) =>
      new ManagedRemoteProviderHost({
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
            return createNodeProviderAdapter({
              provider: provider as "codex" | "claude",
              repositoryRoot,
              resolveArtifact,
              ...(providerHost.executables?.[provider as "codex" | "claude"] === undefined
                ? {}
                : {
                    executable: providerHost.executables[provider as "codex" | "claude"],
                  }),
              // ADR-0612: the signed command fixes the provider; the `routine` route for it sets
              // the model and effort, and the configured ones stand while the role lists none.
              ...nodeRouteForProvider({
                role: "routine",
                provider: provider as "codex" | "claude",
                configured: {
                  model: providerHost.models?.[provider as "codex" | "claude"],
                  reasoningEffort: providerHost.reasoningEfforts?.[provider as "codex" | "claude"],
                },
              }),
            });
          },
        },
      }),
  };
}

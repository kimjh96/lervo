import { providerSurfaceRoleAt } from "./provider-surface-descriptors.js";
import type { RepositoryAgentArtifact } from "./types.js";

const opaqueSkillResourceExtension =
  /\.(?:7z|a|avi|bin|bmp|class|db|dll|dylib|exe|gif|gz|ico|jar|jpe?g|lockb|mov|mp3|mp4|o|pdf|png|pyc|sqlite3?|tar|ttf|wasm|webp|woff2?|xz|zip)$/i;

function skillResourceContentHandling(path: string): RepositoryAgentArtifact["contentHandling"] {
  return opaqueSkillResourceExtension.test(path) ? "opaque_resource" : "semantic_source";
}

function scopeFor(path: string, local: boolean): RepositoryAgentArtifact["scope"] {
  if (local) return "local_repository";
  if (!path.includes("/") || /^(?:\.agents|\.claude|\.codex|\.github)\//.test(path))
    return "repository";
  return "subtree";
}

function artifact(path: string, value: Profile): RepositoryAgentArtifact {
  const { local = false, ...profile } = value;
  return { ...profile, profileVersion: 1, scope: scopeFor(path, local) };
}

type Profile = Omit<RepositoryAgentArtifact, "profileVersion" | "scope"> & { local?: boolean };

/**
 * Each repository-local agent surface by its documented discovery contract, in the order paths are
 * matched: the first pattern a path matches decides its profile, so a narrower surface comes before
 * the wider one that contains it.
 */
const agentSurfaces: readonly {
  pattern: RegExp;
  profile: Profile | ((path: string) => Profile);
}[] = [
  {
    pattern: /(^|\/)docs\/instructions\/.+\.md$/,
    profile: {
      profileId: "lervo-canonical-instruction-v1",
      provider: "shared",
      role: "behavioral_instruction",
      discovery: "explicit",
      migrationDisposition: "scoped_canonical",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)AGENTS\.override\.md$/,
    profile: {
      profileId: "codex-agents-override-v1",
      provider: "codex",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)AGENTS\.md$/,
    profile: (path) => ({
      profileId: "agents-md-v1",
      provider: "shared",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition:
        providerSurfaceRoleAt(path) === "canonical_agent_instruction"
          ? "canonical"
          : "scoped_canonical",
      contentHandling: "semantic_source",
    }),
  },
  {
    pattern: /(^|\/)CLAUDE\.local\.md$/,
    profile: {
      profileId: "claude-local-memory-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    },
  },
  {
    pattern: /(^|\/)(?:\.claude\/)?CLAUDE\.md$/,
    profile: (path) => ({
      profileId: "claude-memory-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition:
        providerSurfaceRoleAt(path) === "provider_instruction_bridge"
          ? "provider_bridge"
          : "provider_specific_review",
      contentHandling: "semantic_source",
    }),
  },
  {
    pattern: /(^|\/)\.claude\/rules\/.+\.md$/,
    profile: {
      profileId: "claude-project-rules-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic_or_path_conditional",
      migrationDisposition: "provider_specific_review",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.agents\/skills\/[^/]+\/SKILL\.md$/,
    profile: {
      profileId: "codex-agent-skills-location-v1",
      provider: "shared",
      role: "skill",
      discovery: "conditional",
      migrationDisposition: "portable_skill",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.agents\/skills\//,
    profile: (path) => ({
      profileId: "codex-agent-skill-resource-v1",
      provider: "shared",
      role: "skill_resource",
      discovery: "on_demand",
      migrationDisposition: "portable_skill_resource",
      contentHandling: skillResourceContentHandling(path),
    }),
  },
  {
    pattern: /(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/,
    profile: {
      profileId: "claude-agent-skills-location-v1",
      provider: "claude",
      role: "skill",
      discovery: "conditional",
      migrationDisposition: "portable_skill_review",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.claude\/skills\//,
    profile: (path) => ({
      profileId: "claude-agent-skill-resource-v1",
      provider: "claude",
      role: "skill_resource",
      discovery: "on_demand",
      migrationDisposition: "portable_skill_review",
      contentHandling: skillResourceContentHandling(path),
    }),
  },
  {
    pattern: /(^|\/)\.claude\/commands\/.+\.md$/,
    profile: {
      profileId: "claude-legacy-command-v1",
      provider: "claude",
      role: "legacy_command",
      discovery: "explicit",
      migrationDisposition: "workflow_review",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.claude\/output-styles\/.+\.md$/,
    profile: {
      profileId: "claude-output-style-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "explicit",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.claude\/workflows\/.+\.md$/,
    profile: {
      profileId: "claude-nonstandard-workflow-directory-v1",
      provider: "claude",
      role: "legacy_command",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/agent-memory\//,
    profile: {
      profileId: "claude-agent-memory-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/agents\/.+\.md$/,
    profile: {
      profileId: "claude-subagent-v1",
      provider: "claude",
      role: "agent_definition",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.codex\/agents\/.+\.toml$/,
    profile: {
      profileId: "codex-custom-agent-v1",
      provider: "codex",
      role: "agent_definition",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.codex\/rules\/.+\.rules$/,
    profile: {
      profileId: "codex-command-rules-v1",
      provider: "codex",
      role: "execution_policy",
      discovery: "client_enforced",
      migrationDisposition: "execution_policy_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.codex\/hooks\.json$/,
    profile: {
      profileId: "codex-hooks-v1",
      provider: "codex",
      role: "lifecycle_hook",
      discovery: "client_enforced",
      migrationDisposition: "execution_policy_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/hooks\.json$/,
    profile: {
      profileId: "claude-nonstandard-hooks-file-v1",
      provider: "claude",
      role: "lifecycle_hook",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/metrics\//,
    profile: {
      profileId: "claude-local-metrics-v1",
      provider: "claude",
      role: "unknown",
      discovery: "not_current_standard",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    },
  },
  {
    pattern: /(^|\/)\.codex\/config\.toml$/,
    profile: {
      profileId: "codex-project-config-v1",
      provider: "codex",
      role: "client_configuration",
      discovery: "trusted_project_only",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/settings\.local\.json$/,
    profile: {
      profileId: "claude-local-settings-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    },
  },
  {
    pattern: /(^|\/)\.claude\/settings\.json$/,
    profile: {
      profileId: "claude-project-settings-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.claude\/\.worktreeinclude$/,
    profile: {
      profileId: "claude-nonstandard-worktree-include-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.worktreeinclude$/,
    profile: {
      profileId: "claude-worktree-include-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)(?:\.claude-plugin\/(?:plugin|marketplace)\.json$|\.claude\/plugins\/)/,
    profile: {
      profileId: "claude-plugin-configuration-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.mcp\.json$/,
    profile: {
      profileId: "claude-project-mcp-v1",
      provider: "claude",
      role: "tool_configuration",
      discovery: "approval_required",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)\.codex\/skills\//,
    profile: (path) => ({
      profileId: "codex-legacy-or-custom-skill-location-v1",
      provider: "codex",
      role: /(^|\/)SKILL\.md$/.test(path) ? "skill" : "skill_resource",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    }),
  },
  {
    pattern: /(^|\/)\.agents\//,
    profile: {
      profileId: "unrecognized-agents-surface-v1",
      provider: "unknown",
      role: "unknown",
      discovery: "not_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    },
  },
  {
    pattern: /(^|\/)SKILL\.md$/,
    profile: {
      profileId: "agent-skills-package-v1",
      provider: "shared",
      role: "skill",
      discovery: "explicit",
      migrationDisposition: "portable_skill_review",
      contentHandling: "semantic_source",
    },
  },
  {
    pattern: /(^|\/)\.github\/copilot-instructions\.md$/,
    profile: {
      profileId: "copilot-repository-instructions-v1",
      provider: "copilot",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    },
  },
];

/**
 * Classifies repository-local agent surfaces by their documented discovery
 * contract. This is deliberately path-only: recognizing a surface never means
 * that a provider loaded, trusted, enabled, or used it.
 */
export function repositoryAgentArtifactForPath(path: string): RepositoryAgentArtifact | undefined {
  const normalized = path.replaceAll("\\", "/");
  const surface = agentSurfaces.find(({ pattern }) => pattern.test(normalized));
  if (surface === undefined) return undefined;
  return artifact(
    normalized,
    typeof surface.profile === "function" ? surface.profile(normalized) : surface.profile,
  );
}

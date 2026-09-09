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

function artifact(
  path: string,
  value: Omit<RepositoryAgentArtifact, "profileVersion" | "scope"> & { local?: boolean },
): RepositoryAgentArtifact {
  const { local = false, ...profile } = value;
  return { ...profile, profileVersion: 1, scope: scopeFor(path, local) };
}

/**
 * Classifies repository-local agent surfaces by their documented discovery
 * contract. This is deliberately path-only: recognizing a surface never means
 * that a provider loaded, trusted, enabled, or used it.
 */
export function repositoryAgentArtifactForPath(path: string): RepositoryAgentArtifact | undefined {
  const normalized = path.replaceAll("\\", "/");

  if (/(^|\/)docs\/instructions\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "lervo-canonical-instruction-v1",
      provider: "shared",
      role: "behavioral_instruction",
      discovery: "explicit",
      migrationDisposition: "scoped_canonical",
      contentHandling: "semantic_source",
    });
  }

  if (/(^|\/)AGENTS\.override\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-agents-override-v1",
      provider: "codex",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)AGENTS\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "agents-md-v1",
      provider: "shared",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: normalized === "AGENTS.md" ? "canonical" : "scoped_canonical",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)CLAUDE\.local\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-local-memory-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    });
  }
  if (/(^|\/)(?:\.claude\/)?CLAUDE\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-memory-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition:
        normalized === "CLAUDE.md" ? "provider_bridge" : "provider_specific_review",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.claude\/rules\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-project-rules-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "automatic_or_path_conditional",
      migrationDisposition: "provider_specific_review",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.agents\/skills\/[^/]+\/SKILL\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-agent-skills-location-v1",
      provider: "shared",
      role: "skill",
      discovery: "conditional",
      migrationDisposition: "portable_skill",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.agents\/skills\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-agent-skill-resource-v1",
      provider: "shared",
      role: "skill_resource",
      discovery: "on_demand",
      migrationDisposition: "portable_skill_resource",
      contentHandling: skillResourceContentHandling(normalized),
    });
  }
  if (/(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-agent-skills-location-v1",
      provider: "claude",
      role: "skill",
      discovery: "conditional",
      migrationDisposition: "portable_skill_review",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.claude\/skills\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-agent-skill-resource-v1",
      provider: "claude",
      role: "skill_resource",
      discovery: "on_demand",
      migrationDisposition: "portable_skill_review",
      contentHandling: skillResourceContentHandling(normalized),
    });
  }
  if (/(^|\/)\.claude\/commands\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-legacy-command-v1",
      provider: "claude",
      role: "legacy_command",
      discovery: "explicit",
      migrationDisposition: "workflow_review",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.claude\/output-styles\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-output-style-v1",
      provider: "claude",
      role: "behavioral_instruction",
      discovery: "explicit",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.claude\/workflows\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-nonstandard-workflow-directory-v1",
      provider: "claude",
      role: "legacy_command",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/agent-memory\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-agent-memory-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/agents\/.+\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-subagent-v1",
      provider: "claude",
      role: "agent_definition",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.codex\/agents\/.+\.toml$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-custom-agent-v1",
      provider: "codex",
      role: "agent_definition",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.codex\/rules\/.+\.rules$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-command-rules-v1",
      provider: "codex",
      role: "execution_policy",
      discovery: "client_enforced",
      migrationDisposition: "execution_policy_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.codex\/hooks\.json$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-hooks-v1",
      provider: "codex",
      role: "lifecycle_hook",
      discovery: "client_enforced",
      migrationDisposition: "execution_policy_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/hooks\.json$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-nonstandard-hooks-file-v1",
      provider: "claude",
      role: "lifecycle_hook",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/metrics\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-local-metrics-v1",
      provider: "claude",
      role: "unknown",
      discovery: "not_current_standard",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    });
  }
  if (/(^|\/)\.codex\/config\.toml$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-project-config-v1",
      provider: "codex",
      role: "client_configuration",
      discovery: "trusted_project_only",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/settings\.local\.json$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-local-settings-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "local_preserve",
      contentHandling: "local_inventory_only",
      local: true,
    });
  }
  if (/(^|\/)\.claude\/settings\.json$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-project-settings-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (
    /(^|\/)\.worktreeinclude$/.test(normalized) &&
    !/(^|\/)\.claude\/\.worktreeinclude$/.test(normalized)
  ) {
    return artifact(normalized, {
      profileId: "claude-worktree-include-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "client_enforced",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.claude\/\.worktreeinclude$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-nonstandard-worktree-include-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (
    /(^|\/)\.claude-plugin\/(?:plugin\.json|marketplace\.json)$/.test(normalized) ||
    /(^|\/)\.claude\/plugins\//.test(normalized)
  ) {
    return artifact(normalized, {
      profileId: "claude-plugin-configuration-v1",
      provider: "claude",
      role: "client_configuration",
      discovery: "conditional",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.mcp\.json$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "claude-project-mcp-v1",
      provider: "claude",
      role: "tool_configuration",
      discovery: "approval_required",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.codex\/skills\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "codex-legacy-or-custom-skill-location-v1",
      provider: "codex",
      role: /(^|\/)SKILL\.md$/.test(normalized) ? "skill" : "skill_resource",
      discovery: "not_current_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)\.agents\//.test(normalized)) {
    return artifact(normalized, {
      profileId: "unrecognized-agents-surface-v1",
      provider: "unknown",
      role: "unknown",
      discovery: "not_standard",
      migrationDisposition: "nonstandard_preserve",
      contentHandling: "local_inventory_only",
    });
  }
  if (/(^|\/)SKILL\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "agent-skills-package-v1",
      provider: "shared",
      role: "skill",
      discovery: "explicit",
      migrationDisposition: "portable_skill_review",
      contentHandling: "semantic_source",
    });
  }
  if (/(^|\/)\.github\/copilot-instructions\.md$/.test(normalized)) {
    return artifact(normalized, {
      profileId: "copilot-repository-instructions-v1",
      provider: "copilot",
      role: "behavioral_instruction",
      discovery: "automatic",
      migrationDisposition: "provider_specific_preserve",
      contentHandling: "semantic_source",
    });
  }
  return undefined;
}

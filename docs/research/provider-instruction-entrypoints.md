# Provider instruction entrypoint research

Status: `accepted input`  
As of: 2026-08-23

## Question

Lervo keeps repository knowledge provider-neutral, but coding agents discover different files. The design must distinguish canonical policy, provider discovery bridges, and evidence that a run loaded or used instructions.

## Entrypoint comparison

| Ecosystem | Repository entrypoint | Discovery and hierarchy | Lervo treatment |
| --- | --- | --- | --- |
| AGENTS.md open format | Directory-scoped `AGENTS.md` | Plain Markdown convention; the closest file scopes a subtree | Provider-neutral canonical instructions |
| OpenAI Codex | `AGENTS.override.md` / `AGENTS.md` plus configured fallbacks | Combines files from repository root to current directory; closer instructions apply later; default aggregate limit is 32 KiB | Reads root and scoped AGENTS natively; no Codex bridge |
| Anthropic Claude Code | `CLAUDE.md` or `.claude/CLAUDE.md` | User, project, local, and managed-policy layers; expands `@path` imports outside code spans | Thin root CLAUDE managed block imports root AGENTS |
| Google Gemini CLI | `GEMINI.md` by default | Global, workspace/ancestor, and just-in-time subtree context; supports `@file.md` | Future versioned provider profile, not v0 |
| GitHub Copilot | Surface-dependent files including `.github/copilot-instructions.md` | IDE, coding agent, and review surfaces support different combinations | Generate nothing until each surface has a tested profile |

Primary sources: [AGENTS.md](https://agents.md/), [OpenAI Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Claude Code memory](https://code.claude.com/docs/en/memory), [Gemini CLI context](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md), and [GitHub Copilot instruction support](https://docs.github.com/en/copilot/reference/custom-instructions-support).

## Repository surface inventory

Entrypoints do not cover every skill, workflow, policy, hook, or client setting.

| Surface | Meaning | Migration disposition |
| --- | --- | --- |
| `AGENTS.md`, `AGENTS.override.md` | Codex behavioral instructions | Preserve canonical and subtree sources |
| `.agents/skills/<name>/SKILL.md` | Portable Agent Skill | Validate the skill contract and preserve resources |
| `.codex/rules/*.rules` | Codex command policy | Local inventory only; never merge with prose instructions |
| `.codex/config.toml`, `.codex/agents/*.toml`, `.codex/hooks.json` | Client config, custom agents, lifecycle hooks | Local inventory only; require provider-enforcement evidence |
| `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` | Claude memory and instructions | Preserve; only the root profiled bridge is managed |
| `.claude/rules/**/*.md` | Modular Claude behavioral rules | Semantic source with provider-specific review |
| `.claude/skills/**`, `.claude/commands/**` | Skills and legacy workflows | Portable-skill or workflow review |
| `.claude/agents/**` | Claude subagent definitions | Local inventory only |
| `.claude/settings*.json`, `.mcp.json` | Permissions, hooks, environment, and tool configuration | Local inventory only; exclude bytes from semantic compilation |

The [Agent Skills specification](https://agentskills.io/specification) defines `SKILL.md` and optional `scripts/`, `references/`, and `assets/`; it does not define `.agents/rules`. Lervo preserves `.agents/rules/**` as `not_standard` and makes no automatic-discovery claim. Near-miss filenames and configured fallbacks are inventory, not evidence of provider behavior.

Additional primary sources: [Codex Agent Skills](https://learn.chatgpt.com/docs/build-skills), [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic), [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude skills and commands](https://code.claude.com/docs/en/slash-commands), [Claude settings](https://code.claude.com/docs/en/settings), and [Claude subagents](https://code.claude.com/docs/en/sub-agents).

## Design consequences

- Root `AGENTS.md` is canonical shared policy; provider files do not duplicate it.
- A bridge records an explicit provider, profile ID and version, discovery contract, canonical path, target path, and managed block.
- `claude_agents_import_v1` supports only root `AGENTS.md` to root `CLAUDE.md`. A new target contains only the managed bridge; an existing unmanaged target is never appended automatically.
- The read-only plan binds canonical and target hashes, profile, snapshots, registry, and structural outputs. Target-byte changes require exact approval.
- The target, bridge record, concept navigation, and event apply in one durable transaction.
- A valid bridge proves only discovery compatibility. `loaded`, `injected`, and `used` require run telemetry.

Gemini, Copilot, automatic subtree expansion, provider-setting changes, and insertion into user-owned instruction regions require separate future profiles.

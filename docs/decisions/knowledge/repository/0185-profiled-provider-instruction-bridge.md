# ADR-0185: Profiled Provider Instruction Bridge

- Status: accepted
- Decision date: 2026-08-23

## Context

Provider instruction files have different discovery and hierarchy. Copying policy creates divergent truths, while merely mentioning AGENTS.md in CLAUDE.md does not invoke Claude's import syntax. Compatibility must preserve provider semantics and user-owned regions.

## Decision

A researched profile registry drives lervo knowledge instruction bridge --provider <provider>. Root AGENTS.md is canonical; bridges are provider discovery adapters, not duplicated knowledge publications.

The first profile, claude_agents_import_v1@1, makes the provider_entry managed block in root CLAUDE.md exactly @AGENTS.md plus LF. A new target contains only that block. An existing target is updated only when a valid CommonMark managed-block parser finds provider_entry; prefix, suffix, markers, and other blocks remain byte-identical. Lervo never appends to an unmanaged existing file.

Plans bind profile/version, canonical/target before/after hashes/sizes, managed-content hash, snapshots, policy, registry, and structural output. Create/update requires exact plan and item approval. An already-current ready plan that only refreshes records/projections needs plan ID but no unnecessary item approval.

Tracked .lervo/knowledge/instruction-bridges/<bridge-id>.yaml binds project/provider/canonical/target identity and current profile/file hashes. Canonical changes update it in the same explicit transaction. Target bytes, record, concepts/navigation, projections, and generation manifest share one durable transaction and existing recovery rules.

Lint validates record schema/content-addressed ID, current file hashes, and exact managed content. Valid discovery readiness is not provider loaded/injected/used evidence.

Gemini/Copilot, subtree bridges, provider settings, unmanaged targets, and user-region insertion remain outside scope. Success emits operation=instruction_bridge_update with only bounded profile/digests/IDs/counts. Events omit paths/content; receipts use provider/profile, path digests, target hash, and bridge ID.

## Consequences

Fixtures verify new targets, preservation of unmanaged bytes, exact approval, unmanaged-target rejection, lint/current replanning, rollback, dry-plan privacy, and path-free events. Lervo dogfood verifies its real CLAUDE.md bridge, record, lint/query, and no-op refresh.

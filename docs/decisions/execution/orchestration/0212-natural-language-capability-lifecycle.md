# ADR-0212: Natural-language capability lifecycle

Status: accepted
Date: 2026-08-25

Partially superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the `lervo migrate capabilities` alias is removed. `lervo capability migrate` performs the same promotion.

## Context

Documents already recorded recommendation, selection, loading, delivery, and reference evidence, but skills, MCP servers, and plugins were primarily explicit package coordinates. Resolution and provider activation could neither select a suitable package from an ordinary task nor prove that verified skill instructions entered the turn. Existing provider configuration may contain secrets and cannot be copied safely during repository migration.

## Decision

- Capability manifests may declare bounded discovery metadata and opt into deterministic automatic selection. Explicit requests and role defaults remain authoritative. Automatic selection uses only verified metadata, a fixed score threshold, stable ordering, and at most eight results.
- Emit distinct `capability.recommended`, `capability.selected`, `capability.loaded`, and existing `capability.activated` events. Payloads retain coordinates, reason codes, scores, or digests, but never raw task or package content.
- Rehash selected skill packages, load bounded UTF-8 `SKILL.md`, include the exact instructions in the managed turn, and emit `skill.invoked` and `skill.completed`. This proves only Lervo orchestration; semantic model use remains unobservable.
- `lervo migrate capabilities` safely promotes valid `.agents/skills` into immutable project capability packages. For a manifestless standard Agent Skill, migration synthesizes an unsigned `1.0.0` all-role contract only inside the installed package and preserves source bytes. Provider-owned MCP and plugin settings are observed as unmanaged and never copied. Managed behavior requires a secret-free Lervo package and adapter receipt.
- Hub capability publications carry a verified structure header and deterministic two-hex ID shard. Document shared context and OKF knowledge bundles retain their own schemas.

## Consequences

Natural-language tasks can select eligible local capabilities without a Hub, while evidence keeps recommendation, loading, activation, invocation, and semantic use distinct. Existing manifests remain valid because discovery metadata is optional. Loose skills gain a content-preserving migration path. Provider configuration with unknown authority or secrets fails closed rather than being silently adopted.

## Verification

Schema validation, deterministic recommendation, loose-skill migration, managed skill invocation events, adapter activation contracts, Hub HTTP structure, redaction, and managed-run tests cover this decision.

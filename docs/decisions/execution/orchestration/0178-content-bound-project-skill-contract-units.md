# ADR-0178: Content-Bound Project Skill Contract Units

- Status: accepted
- Decision date: 2026-08-23

## Context

Skill files were inventoried but lacked stable logical identity and version roles, and manifest `contentHash` was not proven against package bytes. Not every `SKILL.md` follows Lervo's manifest contract.

## Decision

`lervo-skill-contract-v1+skill-schema-v1` applies only to repository `.agents/skills/<package>/lervo-skill.json` packages. Manifestless `SKILL.md`, `.codex` skills, and user, organization, or external roots retain generic file/Markdown coverage.

The strict manifest must pass the skill schema with `source.kind=project`. Existing bounded package hashing rereads up to 256 regular files and 16 MiB, excluding the manifest; both hashes must equal `contentHash`. Symlinks, races, limit overflow, or mismatch fail without partial units.

The exact manifest becomes `skill_contract` at `skill:<id>@<version>/manifest`. An included `SKILL.md`, when present, becomes `skill:<id>@<version>/instructions`. Stable IDs include the source path and locator; versions bind exact bytes and adapter. Generic file, JSON, and Markdown units remain alongside dedicated units. No instruction file becomes mandatory, and other assets are not merged into instructions.

Trust, signatures, scope, compatibility, and capabilities are declarations only. A hash match proves neither identity, safety, quality, verified knowledge, nor resolved, invoked, or completed use. Those claims require execution evidence.

Failures redact IDs, versions, paths, bodies, identities, URIs, tools, hashes, and secrets, and mutate nothing.

## Consequences

Fixtures build a real package, verify manifest and instruction units with stable locators, and detect post-manifest instruction mutation without leakage. Full scanner, build, and dogfood flows preserve generic projections and clone-reproducible snapshots.

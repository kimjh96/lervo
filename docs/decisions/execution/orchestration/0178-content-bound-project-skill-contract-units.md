# ADR-0178: Content-Bound Project Skill Contract Units

- Status: accepted
- Decision date: 2026-08-23

## Context

Skill files were inventoried but lacked stable logical identity/version roles and did not prove manifest contentHash against package bytes. Not every SKILL.md follows Lervo's manifest contract.

## Decision

lervo-skill-contract-v1+skill-schema-v1 applies only to repository .agents/skills/<package>/lervo-skill.json packages. Manifestless SKILL.md, .codex skills, and user/organization/external roots keep generic file/Markdown coverage.

The strict manifest must pass skill schema with source.kind=project. Existing bounded package hashing rereads up to 256 regular files/16 MiB excluding manifest, and both hashes must equal contentHash. Symlinks, races, bounds, and mismatch fail without partial units.

The exact manifest is skill_contract at skill:<id>@<version>/manifest. An included SKILL.md, when present, becomes skill:<id>@<version>/instructions. Stable IDs include source path/locator; versions bind exact bytes and adapter. Generic file/JSON/Markdown units remain alongside dedicated units. No instruction file is newly required and other assets are not merged as instructions.

Trust, signatures, scope, compatibility, and capabilities are declarations only. Hash match proves neither identity, safety, quality, verified knowledge, nor resolved/invoked/completed use. Those require their execution evidence.

Failures redact IDs, versions, paths, bodies, identities, URIs, tools, hashes, and secrets and mutate nothing.

## Consequences

Fixtures build a real package and verify manifest/instruction units and stable locators, then detect post-manifest instruction mutation without leakage. Full scanner/build/dogfood preserve generic projections and clone-reproducible snapshots.

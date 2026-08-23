# ADR-0016: Local skill resolution and per-run lock

- Status: accepted
- Decision date: 2026-08-19

## Context

Skill manifests existed without reproducible discovery or a lock identifying the candidate selected for a run. Treating provider-read files or user-run skills as Lervo-observed selection would collapse `resolved`, `invoked`, and `used`. User-global skills also reside outside the repository and require explicit source-preservation, symlink, and privacy boundaries.

## Decision

### Discovery and package integrity

For requested `lervo run --skill <skill-id>` values only, inspect project `.agents/skills/*/lervo-skill.json` and user `~/.agents/skills/*/lervo-skill.json`. Ignore directories without manifests and unrequested IDs. Organization and external registries remain future source adapters.

Hash every regular file except top-level `lervo-skill.json` in relative-path order, including its path, byte count, and body. Require manifest `contentHash` to match.

Follow no symlink in a discovery root, candidate directory, or package. Limit packages to 256 files and 16 MiB, and manifests to 1 MiB. Reject identity, size, or mtime changes during reading. Never modify skill source.

### Compatibility and selection

Require enabled scope, provider, role, minimum runtime version, platform, required tools, and role-allowed capabilities. Do not treat `require_approval`, unknown tools, or unknown platforms as compatible. Validate input/output schema references only syntactically; invocation later resolves schemas and validates calls.

Choose candidates in this order: pinned project candidate, other project candidate, then user candidate. Within a tier, choose the highest semantic version. The same tier and version with different content hashes is `ambiguous_skill_selection`, never an arbitrary choice.

Retain unselected compatible and incompatible candidates in the lock with `source_shadowed`, `version_shadowed`, or specific compatibility reasons.

### `skills.lock` and evidence

Validate `.lervo/skills.lock` against its standalone JSON Schema and cap it at 4 MiB. Record project, generation time, provider, role, runtime, platform, known tools, allowed capabilities, selections, rejections, and machine reasons. URIs remain local.

Preserve existing bytes and `generatedAt` when semantics are unchanged. Never overwrite a schema-invalid or non-regular existing lock. Publish a new lock through a completed same-directory temporary file and rename.

A lock is derived resolution state, not execution evidence. Before execution, atomically record `run.requested`, `run.resolved`, and one `skill.resolved` per selection. Include only skill ID, version, content hash, source kind, and trust level; exclude URI, publisher, reviewer, and body. If event recording fails, do not execute; lock existence alone proves nothing.

This slice neither injects nor invokes skill content, so it emits no `skill.invoked` or `.completed`. Future invocation requires schema resolution, an input digest, capability approval, output artifacts, and an observable provider boundary.

### Failures

| Code | Meaning |
| --- | --- |
| `invalid_skill_manifest`, `invalid_skill_request` | Invalid manifest or requested ID. |
| `content_hash_mismatch`, `unsafe_skill_package` | Unsafe package content or filesystem boundary. |
| `skill_not_found`, `no_compatible_skill`, `ambiguous_skill_selection` | No candidate, no compatible candidate, or conflicting top candidates. |
| `invalid_skill_lock`, `skill_lock_write_failed` | Existing or generated lock is invalid or cannot be atomically written. |
| `unsupported_runtime_platform` | Platform cannot be conservatively classified. |

Errors and events exclude raw manifests, absolute paths, publisher data, and skill bodies. Do not start an adapter before resolution and locking succeed.

## Consequences

Project and user candidates resolve deterministically without a Hub. Higher user versions cannot silently override project choices, and conflicts remain reproducible. User skill source and invalid existing locks are preserved. Evidence keeps `resolved` distinct from `invoked` and `used`.

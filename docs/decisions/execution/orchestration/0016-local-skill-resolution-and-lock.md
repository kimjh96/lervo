# ADR-0016: Local skill resolution and per-run lock

Status: `accepted`
Decision date: 2026-08-19

## Context

Skill manifests existed without reproducible discovery or a lock showing which candidate a run selected. Treating provider-read files or user-run skills as Lervo-observed selection would collapse `resolved`, `invoked`, and `used`. User-global skills also sit outside the repository, requiring explicit source preservation, symlink, and privacy boundaries.

## Decision

### Discovery and package integrity

- For requested `lervo run --skill <skill-id>` values only, inspect project `.agents/skills/*/lervo-skill.json` and user `~/.agents/skills/*/lervo-skill.json`. Ignore directories without manifests and unrequested IDs. Organization and external registries remain future source adapters.
- Hash every regular file except top-level `lervo-skill.json` in relative-path order, including path, byte count, and body. Require manifest `contentHash` to match.
- Follow no symlink in discovery root, candidate directory, or package. Limit packages to 256 files/16 MiB and manifests to 1 MiB; reject identity, size, or mtime changes during reading. Never modify skill source.

### Compatibility and selection

- Require enabled scope, provider, role, minimum runtime version, platform, required tools, and role-allowed capabilities. Do not promote `require_approval`, unknown tools, or unknown platforms to compatible.
- Validate input/output schema references syntactically only; invocation later resolves schemas and validates calls.
- Choose in order: pinned project candidate, other project candidate, then user candidate. Within a tier choose highest semantic version.
- Same tier/version with different content hashes is `ambiguous_skill_selection`, never arbitrary choice.
- Retain unselected compatible and incompatible candidates in the lock with `source_shadowed`, `version_shadowed`, or specific compatibility reasons.

### `skills.lock` and evidence

- Validate `.lervo/skills.lock` against its standalone JSON Schema and cap it at 4 MiB. Record project, generation time, provider/role/runtime/platform, known tools and allowed capabilities, selections, rejections, and machine reasons. URIs stay local.
- Preserve existing bytes and `generatedAt` when semantics are unchanged. Never overwrite a schema-invalid or non-regular existing lock. Publish a new lock by completed same-directory temporary file plus rename.
- A lock is derived resolution state, not execution evidence. Atomically record `run.requested`, `run.resolved`, and one `skill.resolved` per selection before execution. Include only skill ID/version/content hash/source kind/trust level, excluding URI, publisher, reviewer, and body.
- If event recording fails, do not execute; lock existence alone proves nothing.
- This slice does not inject or invoke skill content, so it emits no `skill.invoked` or `.completed`. Future invocation needs schema resolution, input digest, capability approval, output artifacts, and an observable provider boundary.

### Failures

| Code | Meaning |
| --- | --- |
| `invalid_skill_manifest`, `invalid_skill_request` | Invalid manifest or requested ID. |
| `content_hash_mismatch`, `unsafe_skill_package` | Package content or filesystem boundary is unsafe. |
| `skill_not_found`, `no_compatible_skill`, `ambiguous_skill_selection` | No candidate, no compatible candidate, or conflicting top candidates. |
| `invalid_skill_lock`, `skill_lock_write_failed` | Existing/generated lock is invalid or cannot be atomically written. |
| `unsupported_runtime_platform` | Platform cannot be conservatively classified. |

Errors and events exclude raw manifests, absolute paths, publisher data, and skill bodies. Do not start an adapter before resolution and locking succeed.

## Consequences

- Project and user candidates resolve deterministically without a Hub.
- Higher user versions cannot silently override project choices, and conflicts remain reproducible.
- Lervo preserves user skill source and invalid existing locks.
- Evidence keeps `resolved` distinct from `invoked` and `used`.

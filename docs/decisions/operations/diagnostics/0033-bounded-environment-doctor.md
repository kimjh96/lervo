# ADR-0033: Scope-explicit local environment diagnostics

Status: `accepted`
Decision date: 2026-08-19

## Context

The original doctor checked event chains and knowledge sources but could appear to certify documents, skills, and provider runtime it never inspected. Corruption differs from unavailable readiness evidence, and a successful provider version command proves neither authentication nor a managed session.

## Decision

### Independent checks and states

Add checks for:

- `document_registry`: sharded or legacy layout/contract
- `document_sources`: safe regular-file sources at registered relative paths
- `skill_packages`: project/user manifests, complete content hashes, safe paths
- `skill_lock`: re-resolved selections/rejections under recorded environment
- `provider_codex_runtime`: configured Codex executable version
- `provider_claude_runtime`: Agent SDK bundled executable version

Each is `healthy` (completed and valid), `unhealthy` (directly verified as missing/corrupt/stale), or `unknown` (missing prerequisite/runtime or failed probe). No skills plus no lock is healthy; packages without a lock are unknown. With a lock, rerun the common resolver from recorded runtime/requested IDs and compare all selections/rejections, detecting changed hashes and newly higher-priority candidates.

Overall precedence is unhealthy, unknown, healthy. Exit 0 only when every check is healthy; unknown never means healthy.

### Provider discovery behind adapters

- Common adapter contract runs a bounded `--version` probe without a shell.
- Codex resolves PATH or explicit executable. Claude resolves the current OS/CPU Agent SDK native package and bundled executable. Unsupported platforms and missing packages remain non-success.
- Limit probe to 5 seconds and 16 KiB output; retain only the first ASCII line up to 200 characters.
- `available` proves only that command. It does not check authentication, account, network, model access, or managed-session success.

### Read-only composition

Keep document, skill, and provider checks in separate modules. CLI runs them in parallel and combines a common `@lervo/diagnostics` report; core knows no provider-package or layout details. Write no file, CAS object, event, or Hub state, and do not claim Hub was checked.

### Issues and privacy

| Issue | Meaning |
| --- | --- |
| `document_registry_invalid`, `document_source_invalid` | Registry or registered source is unsafe/invalid, or prerequisite prevents judgment. |
| `skill_package_invalid` | Invalid manifest, hash, or package path. |
| `skill_lock_missing`, `skill_lock_invalid`, `skill_lock_stale` | Missing comparison source, invalid lock, or mismatch to current resolution. |
| `provider_executable_missing`, `provider_probe_failed`, `provider_platform_unsupported` | Missing executable, bounded probe failure, or unsupported resolution platform. |

Reports exclude absolute paths, document/skill bodies, publishers, credentials, environment, and raw provider output. Probe children receive only PATH. Doctor emits no event.

Fixtures cover empty environment, missing registered source, wrong skill hash, missing/stale lock, bounded real child-process version output, absent executable, and CLI exit 1 for unknown.

## Consequences

Doctor no longer certifies unexamined state and distinguishes damaged sources from unknown provider readiness while preserving provider-specific installation logic behind adapters.

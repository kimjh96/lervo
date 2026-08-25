# ADR-0033: Scope-explicit local environment diagnostics

- Status: `accepted`
- Decision date: 2026-08-19

## Context

The original doctor checked event chains and knowledge sources but could appear to certify documents, skills, and provider runtimes it had not inspected. Corruption must be distinguished from unavailable readiness evidence. A successful provider version command proves neither authentication nor a managed session.

## Decision

### Independent checks and states

Add these checks:

- `document_registry`: sharded or legacy layout and contract
- `document_sources`: safe regular-file sources at registered relative paths
- `skill_packages`: project and user manifests, complete content hashes, and safe paths
- `skill_lock`: selections and rejections re-resolved under the recorded environment
- `provider_codex_runtime`: configured Codex executable version
- `provider_claude_runtime`: Agent SDK bundled executable version

A check is `healthy` when completed and valid, `unhealthy` when directly verified as missing, corrupt, or stale, and `unknown` when a prerequisite or runtime is missing or a probe fails. No skills and no lock is healthy; packages without a lock are unknown.

When a lock exists, rerun the common resolver with its recorded runtime and requested IDs, then compare every selection and rejection. This detects changed hashes and newly available higher-priority candidates.

Overall-state precedence is `unhealthy`, `unknown`, then `healthy`. Exit 0 only when every check is healthy; `unknown` never means healthy.

### Provider discovery behind adapters

The common adapter contract runs a bounded `--version` probe without a shell. Codex resolves from PATH or an explicit executable. Claude resolves the current OS/CPU Agent SDK native package and its bundled executable. Unsupported platforms and missing packages remain non-success states.

Limit probes to 5 seconds and 16 KiB of output. Retain only the first ASCII line, truncated to 200 characters. `available` proves only that the version command ran; it does not establish authentication, account status, network access, model access, or managed-session success.

### Read-only composition

Keep document, skill, and provider checks in separate modules. The CLI runs them in parallel and combines a common `@lervo/diagnostics` report. Core contains no provider-package or layout details.

Write no file, CAS object, event, or Hub state, and do not claim that Hub was checked.

### Issues and privacy

| Issue | Meaning |
| --- | --- |
| `document_registry_invalid`, `document_source_invalid` | The registry or registered source is unsafe or invalid, or a prerequisite prevents judgment. |
| `skill_package_invalid` | A manifest, hash, or package path is invalid. |
| `skill_lock_missing`, `skill_lock_invalid`, `skill_lock_stale` | The comparison source is missing, the lock is invalid, or current resolution differs. |
| `provider_executable_missing`, `provider_probe_failed`, `provider_platform_unsupported` | The executable is missing, the bounded probe failed, or the resolution platform is unsupported. |

Reports exclude absolute paths, document and skill bodies, publishers, credentials, environment values, and raw provider output. Probe children receive only PATH. Doctor emits no event.

Fixtures cover an empty environment, a missing registered source, an incorrect skill hash, a missing or stale lock, bounded real child-process version output, an absent executable, and CLI exit 1 for `unknown`.

## Consequences

Doctor no longer certifies unexamined state. It distinguishes damaged sources from unknown provider readiness while keeping provider-specific installation logic behind adapters.

# Telemetry privacy and threat boundaries

## Telemetry privacy registry

The registry covers every top-level payload field in the closed event allowlist. Each entry declares purpose, privacy class, canonical-event retention, schema-bounded cardinality, and export only to local or authorized project nodes. Nested values remain inside their closed parent schema. Prompt, transcript, credential, secret, raw body, request text, context text, and provider output field names fail the audit.

Opaque IDs and hashes are join coordinates, not prose. Repository coordinates must be relative. Counts and durations are aggregate or bounded measurements. Event schemas, allowlists, and redaction remain authoritative; the registry is an audited projection and grants no new collection or export authority.

## Threat model and extension boundary

The integrated model treats repository content, natural-language requests, patches, provider output, skills, capability packages, MCP servers, tool results, remote commands, external systems, and host state as independently untrusted. It covers:

- authority injection, path or symlink escape, secret leakage, dependency and tool-schema substitution;
- event or receipt forgery, replay, and cross-repository or cross-tenant confusion;
- hook latency, graph fan-out, and cost amplification;
- poisoned improvement candidates and presentation shown as verified truth; and
- ambiguous external effects and untrusted third-party execution.

Reviewed in-process built-ins do not authorize arbitrary dynamic loading. Third-party execution remains `disabled_pending_isolation` until an out-of-process protocol supplies exact identity, revocation, filesystem and network controls, CPU, memory and output quotas, runtime-only credentials, quarantine, local fallback, and a passing conformance suite. FH4 passes this gate by preserving disablement, not by claiming implemented isolation.

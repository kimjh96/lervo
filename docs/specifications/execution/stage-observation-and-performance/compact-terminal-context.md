# Compact terminal context implementation

This specification describes compact-context implementation and auxiliary runtime dispatch. [ADR-0451](../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md) owns the compact-mode decision; [ADR-0467](../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) defines owner-turn capture.

- [Knowledge snapshot identity cache](compact-terminal-context/knowledge-snapshot-cache.md): validation, reuse, publication, and evidence limits.
- [Compact assembly](compact-terminal-context/compact-assembly.md): preparation, delivered context, bounds, and owner-turn capture.
- [Detached prefetch and runtime dispatch](compact-terminal-context/runtime-dispatch.md): Stop handling, prefetch, integrity checks, and dispatch.

These source facts establish control flow and cache behavior, not installed latency, a passing performance cohort, successful detached execution, packed-consumer smoke, or publication.

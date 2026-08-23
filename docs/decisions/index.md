# Architecture decisions

Lervo keeps decisions in bounded semantic groups. The numeric ADR prefix remains the stable chronological identity; directories are navigation, not identity. Allowed routes and the leaf bound are tracked in [the repository decision taxonomy](../../.lervo/knowledge/document-layout.yaml).

## Domains

- [Foundation](foundation/)
- [Execution orchestration](execution/orchestration/)
- [Managed providers](execution/providers/)
- [Execution verification](execution/verification/)
- [Knowledge documents](knowledge/documents/)
- [Knowledge semantics](knowledge/semantics/)
- [Repository knowledge](knowledge/repository/)
- [Search](search/)
- [Coordination sync](coordination/sync/)
- [Coordination remote control](coordination/remote-control/)
- [Coordination conversations](coordination/conversations/)
- [Coordination deliberation](coordination/deliberation/)
- [Distribution](distribution/)
- [Release packaging](release/packaging/)
- [Release assurance](release/assurance/)
- [Release bootstrap](release/bootstrap/)
- [Release staging](release/staging/)
- [Operations trace](operations/trace/)
- [Operations diagnostics](operations/diagnostics/)
- [Operations security](operations/security/)
- [Operations services](operations/services/)
- [Operations storage](operations/storage/)

Each leaf is limited by the tracked taxonomy, currently 24 decision documents. Add a meaningful route before exceeding that bound. `foundation` is an explicit domain, not a fallback for unmatched decisions.

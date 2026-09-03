# Architecture decisions

Lervo groups decisions by bounded semantic domain. Numeric ADR prefixes remain stable chronological identities; directories provide navigation, not identity. Allowed routes and leaf limits are defined by [the repository decision taxonomy](../../.lervo/knowledge/document-layout.yaml).

## Domains

- [Foundation](foundation/)
- [Execution orchestration](execution/orchestration/)
- [Execution applications](execution/applications/)
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

The tracked taxonomy currently limits each leaf to 24 decision documents. Add a meaningful route before exceeding that limit. `foundation` is an explicit domain, not a fallback for unmatched decisions.

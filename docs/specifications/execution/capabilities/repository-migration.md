# Repository migration

`lervo migrate capabilities` creates a read-only plan bound to both the executable content hash and the complete package-byte hash. Apply promotes independently valid `.agents/skills/*` packages into immutable project capability packages without changing their content hash. A manifest-only change invalidates the plan and conflicts with an occupied immutable version coordinate.

- [Standard Agent Skills](repository-migration/standard-agent-skills.md)
- [Portable-skill authorization](repository-migration/portable-skill-authorization.md)
- [Provider-owned configuration](repository-migration/provider-owned-configuration.md)

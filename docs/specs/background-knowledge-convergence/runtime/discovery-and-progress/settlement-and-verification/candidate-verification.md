# Candidate verification

The version-nine Lervo repository suite prepares detached candidate worktrees with an offline frozen dependency install and local package build before lint, typecheck, and runtime shards. The primary checkout retains its dependency environment. Preparation failure produces no candidate verification receipt or integration success. The integration ref must contain the source being verified.

Interrupted verification yields `knowledge_cancelled`, distinct from an actual `knowledge_verification_failed`. A cancelled stage may resume only after its current source and delegation checks pass under a new live worker signal. Neither result grants verification success.

[ADR-0450](../../../../../decisions/knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) commits settled reviewed outputs at the start of lifecycle verification, before HEAD-bound publication and bridge planning. The fence admits only that stage's own child commit of the observed `HEAD` with unchanged source bytes. Verification preparation reuses or restores builds of identical inputs.

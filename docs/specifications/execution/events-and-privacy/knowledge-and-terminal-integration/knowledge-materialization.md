# Knowledge materialization

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time.

Canonical provider-entrypoint adoption uses `operation=instruction_canonical_adoption`; its event binds the exact approval digest and creation count but excludes CLAUDE and AGENTS paths and bodies. The local receipt may expose source and canonical content hashes. Failure before event commit restores AGENTS. An interrupted journal requires ordinary explicit recovery and emits no success event.

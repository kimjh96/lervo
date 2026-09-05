# Knowledge materialization

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time.

Canonical provider-entrypoint adoption uses `operation=instruction_canonical_adoption`. Its event binds the exact approval digest and creation count but excludes CLAUDE and AGENTS paths and bodies. The local receipt may expose source and canonical content hashes. Failure before event commit restores AGENTS. An interrupted journal requires ordinary explicit recovery and emits no success event.

Reviewed durable-instruction apply uses `operation=durable_instruction_intake`. Its event binds the pre-apply source snapshot, policy, deterministic compiler, exact approval digest, complete catalog coverage, one created file, before-and-after catalog digests, and time. The event excludes request text, normalized rule text, proposed Markdown, reviewer identity, absolute target paths, and provider output. The local receipt may expose rule and target coordinates.

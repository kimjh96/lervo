# Terminal observations

## Context, reference, and turn evidence

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain:

- Opaque IDs and domain-separated request and retrieval digests.
- Typed grounding status, workflow/source/subject/provider identifiers and bounded reason codes.
- Candidate counts, repository-relative coordinates, hashes, assurance, freshness, lifecycle state, and reference availability.
- Prepared and final repository revisions and the derived changed flag.
- Final verified workstream ID, revision, and snapshot hash.

Direct unmanaged prompt preparation uses grounding reason `unmanaged_terminal_retrieval_only` with empty semantic-action coordinates. The preparation event distinguishes candidate selection, hash-bound loading, hook preparation, provider injection (`unobserved`), and provider use (`unknown`). It never upgrades hook-side preparation into delivery or use.

For a direct root session, `lifecycleStatus: action_required` may coexist with `completionResult: allowed`: the former is an observed repository finding; the latter means the audit did not claim authority to block provider availability. Attached-worker isolation may still record `blocked`. Empty hook success after an internal failure creates neither event nor inferred success.

`terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition, optional completed-deliberation ID, and time.

These terminal events exclude prompts, retrieval-query text, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations do not prove internal reasoning.

## Commit ordering and hook failures

Preparation commits before context; declaration commits after repository work; reference and turn commit together before Stop.

Missing context during mid-turn hook activation emits no event or receipt and requests one bounded continuation. Any valid re-entered Stop marked `stop_hook_active` returns empty success before repository or persistence work and creates no observation or receipt, including when preparation exists. Malformed input, stale declaration, and persistence failure fail closed.

## Additive evolution

Terminal observation evolution is additive and history-preserving. The original base remains accepted; later semantic-grounding, query-projection-receipt, durable-instruction, repository, workstream, and workspace groups are all-or-none.

A query-projection receipt depends on the complete grounding group; an earlier complete grounding group remains valid without that later receipt. Current producers emit the complete latest applicable groups, while consumers treat absent later groups as unobserved. A partial group is invalid, but validation failure never permits deletion, rewriting, or omission of immutable event history.

## Deliberation publication failure

`deliberation.artifact.publication_failed` retains deliberation, role, producer provider, semantic-evaluator provider, round, attempt, artifact ID and content hash, repository-verification status, writing-publication failure, recovery state, bounded failed or missing check IDs, semantic-evaluation status, and repair limit.

It excludes provider output, prompts, transcripts, source bodies, paths, unrestricted errors, and credentials. The event means the provider result remains quarantined in CAS and is recoverable with `lervo deliberate artifact --content-hash`; it is not a published deliberation artifact. Repository verification and writing publication remain independent facts.

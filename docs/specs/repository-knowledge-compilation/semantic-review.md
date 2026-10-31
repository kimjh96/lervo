# Semantic Compilation, Review, and Materialization

Historical: [ADR-0529](../../decisions/knowledge/semantics/0529-remove-the-semantic-compilation-pipeline.md) removed this pipeline. `lervo knowledge materialize --recover` remains for every interrupted knowledge materialization.

This specification defines how Lervo compiles repository evidence, reviews proposed knowledge and applies approved changes through durable transactions.

## Semantic compilation

`knowledge compile --provider codex|claude` runs the installed provider in a temporary directory with filesystem, shell, network, external actions, tools, provider rules, and persistence disabled. The envelope contains untrusted units, exact evidence IDs, and `outputLanguage: en`.

The provider returns schema-valid concepts, claims, and within-response relations citing current versions. Results are `unreviewed`; stability or provider overlap proves neither truth nor consensus.

Exact cross-provider merge is the default derivation. `knowledge fuzzy-merge-candidate` is a separate deterministic local path for concepts with neither exact concept nor exact claim overlap. V1 requires:

- The same concept type.
- At least one shared evidence-unit version.
- At least two shared Unicode claim tokens.
- A Dice score of at least 0.60.
- A mutual-best margin of at least 0.10 on both sides.

It emits at most 64 one-to-one pairs, retains both provider concepts as `unreviewed`, infers no relation, and makes no provider, embedding, network, or Hub call.

## Reconciliation and review

Reconciliation yields create, register-existing, add-relation, managed-block patch, conflict, or skip. Duplicate, fuzzy-pair, or contradiction resolution requires policy authorization and an exact hash. Both fuzzy-pair members are conflicts; `accept-all-safe` selects neither, and hash-bound review may accept at most one.

Human review is an immutable local CAS artifact. Events retain bounded IDs, hashes, counts, policy coordinates, and decision metadata. User-byte patches require separate exact output-hash approval and never enter `accept-all-safe`.

## Direct-terminal instruction capture

Direct terminal grounding may separately materialize one Lervo-generated durable instruction only when the typed one-shot gate proves an explicit low-risk additive repository rule, complete existing-instruction comparison, high confidence, and no ambiguity or conflict. It writes one content-addressed Markdown source and never overwrites user-owned instruction bytes. All other utterance shapes remain ignored, workstream-scoped, or pending.

## Historical development-pattern intake

[ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md) removes direct-terminal portable-skill intake and pattern commands. Ordinary canonicalization candidates and instruction capture retain their separate review contracts.

## Durable materialization

Validate the plan, stage outputs, back up originals, publish exact bytes and deletions, lint, record the event, and clean the transaction. Pre-event failure restores originals; post-event cleanup failure preserves outputs and requires recovery.

Apply captures the repository root, operation list, operation fields, binary bytes and document-layout permit before acquiring the source write gate. Validation, staging, publication and rollback use that private input. Later caller mutation cannot redirect an admitted operation or remove it from the transaction. Recovery also captures its root and event lookup before gate acquisition, keeping the lease and recovery target aligned. The caller retains responsibility for receipt content and event recording.

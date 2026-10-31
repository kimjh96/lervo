# Applied instruction preparation

Status: `active`
As of: 2026-10-09

This implementation of [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) connects exact applied owner-rule preparation to managed context discovery, both terminal providers, and the knowledge-query command. It extends the existing canonical instruction authority; retrieved prose and pending instruction candidates do not become rules.

## Discovery and scope

The existing context filesystem adapter reads root and target-parent `AGENTS.md` files and canonical `docs/instructions/generated/rule_<id>.md` files. Pure scope evaluation uses a bounded `paths` list in YAML front matter. A literal path matches itself and descendants; glob patterns use the existing repository path matcher. Query words, titles, and conversation language do not decide applicability. Files without path scope apply globally unless a [structured context scope](runtime-preparation.md#structured-instruction-applicability) further constrains them. Unsupported or malformed metadata cannot silently become global scope.

Known targets exclude nonmatching scoped rules. Missing or empty targets leave scoped rules unresolved and preserve their complete source and scope metadata for the agent to inspect. This is not proof that future target paths are covered. Global rules remain independently available. Full source bodies preserve conditions and exceptions; the implementation does not infer an exception from free-form text, resolve arbitrary prose conflicts, or override provider-native instruction hierarchy.

Generated-rule discovery admits up to 64 rules and inspects at most 4,096 directory entries. Exceeding either bound fails explicitly; it never selects only the first 16. Each file has a 131,072-byte read ceiling. Safe reads reject symbolic links in every path component, invalid file types, concurrent read changes, empty generated-rule bodies, and invalid UTF-8. Directory identity and membership are checked. This adds no full repository scan, provider turn, or persistent cache.

Managed discovery binds each selected instruction to its full-source hash, including scope metadata. The existing E2 loader rejects changed bytes between discovery and loading. Registered instruction candidates retain the same binding. Existing full-document E1-E3 evidence remains authoritative; this feature does not introduce an event writer or claim provider use.

## Terminal and query delivery

The shared repository-context operation enumerates, reads, packs, and revalidates membership and source bytes before returning owner-rule clauses. It never truncates a clause. Source failure returns an unavailable observation rather than an apparently complete smaller catalog. No new authority or repository mutation is performed.

Compact and retrieval hooks place complete owner-rule bodies ahead of optional workstream or retrieved-document context. Compact output retains its 4,096-byte envelope and retrieval output its 28 KiB envelope. The existing preamble and bookkeeping contract retain priority; a rule that cannot fit is explicitly omitted. Hooks reserve room for one line, at most 600 bytes, that names every omitted rule by its reviewed title and states that it still applies. A crowded prompt, such as one carrying the synchronous turn-declaration contract, therefore never drops a rule silently. Compact hooks still perform no retrieval or provider query projection. Both providers run the same operation and preserve unmanaged preparation evidence.

`lervo knowledge query <query>` also returns applied owner clauses separately from ranked recommendations. Repeat `--path <repository-relative-target>` to supply up to 64 known targets. The command reserves a 12 KiB owner-rule context budget. JSON includes `instructions.context` and `instructions.report`; text output labels prepared clauses, unresolved scope, omissions, and unobserved delivery. Existing hit ordering, scores, corpus processing, and retrieval limits are unchanged. An empty recommendation list does not suppress global rules.

Example:

```bash
lervo knowledge query "change the API serializer" --path packages/api/src/serializer.ts --json
```

This operation covers applied owner-rule files. It does not claim complete applicability across every configured rule, role requirement, source class, or undeclared future path. Managed instruction discovery additionally retains root and parent instructions through its established path.

## Observation contract

`InstructionPreparationReport` schema 1 is optional as `instructions` inside existing preparation diagnostics. Its scope is exactly `applied_owner_rules`. Required fields are schema version, scope, status, nullable catalog digest, target digest, nullable observed/applicable/excluded/unresolved counts, prepared count, nullable omitted count, prepared byte count, bounded reasons, and `delivery=unobserved`.

`complete` means all admitted clauses in this bounded catalog were prepared with resolved path scope. `incomplete` means scope is unresolved or complete clauses did not fit. `unavailable` means catalog/source inspection failed; unknown denominator fields are null, prepared count and bytes are zero, and no body is returned. None of these states is a full context-quality plan, provider acknowledgement, compliance verdict, or effect permit.

The catalog digest binds source paths, full-source hashes, declared scopes, and applicability; the target digest binds normalized targets or an explicit unknown target set. Raw paths, titles, and bodies remain in the private prepared context, not the diagnostic. The diagnostic contains no query text or source content. Historical reports without this optional field remain readable. No per-turn storage collection is introduced.

| Reason                              | Failure meaning                                               |
| ----------------------------------- | ------------------------------------------------------------- |
| `instruction_scope_unresolved`      | Scoped rules exist but current targets are unknown            |
| `instruction_capacity_insufficient` | One or more complete admitted clauses did not fit             |
| `instruction_source_unavailable`    | Source inspection could not produce usable bytes              |
| `instruction_source_changed`        | Membership or source bytes changed during preparation         |
| `instruction_catalog_overflow`      | The bounded catalog could not enumerate every rule            |
| `instruction_scope_invalid`         | Scope metadata or required rule content could not be resolved |
| `instruction_source_unsafe`         | A source path violates the safe-file contract                 |

## Acceptance and remaining work

Regression cases cover more than 16 rules, catalog overflow, explicit target changes, unresolved targets, full exceptions, capacity exhaustion, malformed metadata, invalid UTF-8, ancestor symlinks, and changed hashes between discovery and E2 loading. Both compact terminal adapters prepare full clauses. Conversation and native-chat fixtures load identical canonical rule bodies through the production context operation. Query fixtures verify that changing targets changes instruction applicability without changing ranked results.

[Runtime preparation](runtime-preparation.md) now supplies local-read/profile bindings, structured descriptors and declared conflicts, relevant exact sections and process-local resource admission. Artifact verification, complete corpus/token observation, real-task quality evaluation, and installed cohorts remain in the [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md). Source fixtures establish these narrower behaviors, not full ADR completion or a measured Hit or speed improvement.

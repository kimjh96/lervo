# Continuation Migration and Normalization Ownership

## Continuation detection and migration

An active continuation document is not a permanent entrypoint. Before layout migration, a repository-wide bounded scan finds only declared continuation sources: the dedicated root legacy `HANDOFF.md` alias of the `continuation_source` role, and Markdown with `lervo.workstream.continuation: true` front matter. Under [ADR-0476](../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md), file names, titles, headings, and phrases that merely resemble a handoff never make a candidate.

One unambiguous or explicitly selected source enters an exact, independently cross-checked stage ([ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md); `--apply <plan-id>` asks a fresh no-capability session to review the plan, then commits the result as its own revertable `Lervo Knowledge` commit) that preserves its bytes in CAS, creates `.lervo/state/workstreams/current.json`, and updates resolvable Markdown references. Continuation migration deletes only the dedicated root legacy `HANDOFF.md`.

Every reviewed user-document deletion retires normalization lifecycle records owned by that exact source path in the same durable operation, preventing stale formatter or lint ownership.

An arbitrary continuation source may contain durable knowledge, so its user bytes remain for reviewed normalization and splitting. Multiple declared candidates block without merging or deletion until an exact `--continuation-source` is supplied. With no source, the working agent creates the first snapshot during its terminal turn. The structured snapshot stays outside structural publication; lasting facts belong in routed Markdown.

## Normalization-record relocation

A byte-preserving exact structure move relocates one current single-output normalization record from source to destination in the same durable transaction, preserving reviewed hashes and compiler provenance. A split normalization family fails closed: a plain move lacks a reviewed mapping from multiple owned outputs to the destination.

# ADR-0631: Write reverse ADR header lines as insert-only freshness edits

Status: `accepted`
Decision date: 2026-11-24
Amends: [ADR-0562](../../../foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) (the mechanical edit class), [ADR-0561](../../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (freshness applies only Lervo-managed bytes), [ADR-0463](../0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (freshness candidates)

## Context

When one decision record amends another, or supersedes a named part of it, the older record should name the newer one in its header. On 2026-11-24 the relation web on the Mac found 142 missing reverse lines in 81 decision records. Of these, 138 were missing `Amended by` lines and 4 were missing `Superseded in part by` lines. No record had a full supersession that its own `Status:` line did not declare. The roadmap (core loop, relation web item 7) asks Lervo to write these lines through the freshness apply path.

Two existing rules disagreed:

- ADR-0562 calls a missing reverse line a mechanical edit that Lervo writes with a Tier 0 cross-check, and the relation web specification says the same edit is "never a provider call".
- ADR-0561 keeps AGENTS.md invariant 5 by applying only Lervo-managed freshness bytes. Every decision record outside the publication root is user-owned, so a reverse line would only ever become a `suggested` candidate.

## Decision

### An insert-only reverse line is not an overwrite

A reverse header candidate inserts new header lines into a decision record and changes no existing byte, so it overwrites no user-owned content. Lervo applies it itself, inside the canonical roots of the delegation the owner installed, the same scope in which ADR-0561 lets a lifecycle plan rewrite user files. A record outside those roots is never written. AGENTS.md invariant 5 is unchanged for every other hunk: a candidate that replaces or removes a byte of a user-owned record stays `suggested`.

### What Lervo writes

- The lines come from the relation web, and only from a record that the web knows as an ADR. Each one names another ADR whose header declares `Amends` or `Supersedes in part` for this record.
- One `Amended by:` line lists the amending records in ADR order. One `Superseded in part by:` line per superseded part carries its part label in parentheses.
- Each target is a relative Markdown link to the declaring record, labeled `ADR-NNNN`, with no added prose.
- The lines go after the last `Status`, `Decision date`, supersession or amendment line, including any list under it, and before `Part of` or `Related`. An existing `Amended by` line is never edited; a new line follows it.
- A full supersession that the record's `Status:` line does not declare is never written, because changing the status would overwrite the owner's line.
- The plan is checked against the header grammar. The output must keep every earlier header target and the status, and add exactly the declared lines. Otherwise nothing is written: for example, when the record has no `Status:` line or no header room is left within 80 lines.
- A line that would push the record past the documentation bound, 16,384 bytes or 240 lines, is not written either, so a long record never fails the documentation check that publication waits on. Its reason stays open until the record is split.

### No provider call

The candidate is built without a model. It is an ordinary freshness edit:

- one zero-length hunk, `factual_reference`, needing no cross-check;
- a claim that cites the declaring records' committed bytes;
- the freshness checks run as for any edit. `references_resolve` judges only the inserted lines, so an older broken link elsewhere in the record stays its own finding instead of blocking the reverse line.

The candidate carries a `mechanical` marker with the declarations and the declaring records' content hashes. At apply, a declaring record whose bytes changed supersedes the candidate with `source_changed`.

### Same apply path, commit, notice and revert

- The freshness cycle writes reverse lines after its regular finding work, from the relation web the observation stored, and only when that web describes HEAD.
- The freshness stage's fence includes the identity of the runtime's evaluation logic (ADR-0485), the hash of the installed runtime bundle, so a release that changes those bytes runs the stage once. Until 2026-11-24 the fence held HEAD, status and inputs only, and new freshness behavior waited for the next repository change or UTC day.
- Each record is one candidate and one Lervo commit, `docs: add reverse header lines to ADR-NNNN`. The subject names the record's ADR, because a full decision path would exceed the 100-character commit header. The commit carries the trailers `Lervo-Freshness-Reason: reverse_header` and `Lervo-Freshness-Cross-Check: not_required`.
- One cycle writes at most 8 records. When more remain, or when the stored web is behind HEAD only by Lervo's own knowledge commits, the stage stays open, so the next cycle continues.
- A record with uncommitted edits waits, and so does a record whose declaring record has uncommitted edits, because the relation web reads working bytes.
- Nothing is written unless this host may commit knowledge outputs now (ADR-0466, ADR-0610). A write whose commit did not land ends the cycle.
- The after-the-fact notice reports the commit as a refresh of the record, with `lervo knowledge freshness revert <candidate>` as its undo. A line an earlier candidate proposed is never proposed again, so a reverted line stays out while that candidate's record lasts, even when a later declaration gives the record another line.

## State, events, privacy, and failure meaning

- **State:** the candidate is a freshness candidate under `.lervo/state/knowledge/freshness-candidates/` with the additive `mechanical` field. Readers that do not know the field ignore it.
- **Events:** the existing events record the candidate: `document.freshness.candidate.created`, `.verified` and `.applied`. The values `operation: edit`, `crossCheck: not_required` and `approvalSource: lervo_managed` are already in the contract, so no event schema version or Hub reader changes.
- **Privacy:** the candidate holds repository paths and hashes, and no prompt or provider output.
- **Failure meaning:** the existing codes keep their meaning:
  - `source_changed`: the record or a declaring record moved after the candidate was built;
  - `write_failed`: the record could not be written;
  - `revert_conflict`: the record changed after the line was added.
  - An unplannable header or a failed check builds no candidate, and the reason stays in the web's lifecycle record as a mechanical reason.

## Consequences

- 72 of the 81 records get their reverse lines over about 9 cycles, one commit each, with no provider tokens. The other 9 are already near the documentation bound and keep their reasons until they are split.
- An owner who reverts a reverse line keeps it out while the candidate record lasts. If the declaring record still says `Amends` after the record is pruned, Lervo writes the line again.
- A full supersession that a status does not declare remains a mechanical reason that only a person settles.

## Verification

- `packages/repository-knowledge/test/document-reverse-headers.test.ts` covers declarations, every placement rule, CRLF, front matter, header and document bounds, the grammar self-check, the insert-only reference check, and that a reverse marker never makes a replacing hunk applicable.
- `packages/repository-knowledge-runtime/test/freshness-reverse-headers.test.ts` covers an apply inside the canonical roots with its commit and trailers, a record outside them that stays unwritten, a wait for uncommitted edits, a revert that stays out, the per-cycle bound, and the freshness cycle running it with no provider call.
- A dry run over the Mac's relation web on 2026-11-24 planned 72 records and refused 9 at the documentation bound; every planned record built a verified candidate.

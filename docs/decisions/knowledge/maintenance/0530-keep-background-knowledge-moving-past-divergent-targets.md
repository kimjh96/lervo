# ADR-0530: Keep background knowledge moving past divergent integration targets

Status: `accepted`
Decision date: 2026-10-25
Amends: [ADR-0434](../repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0449](../repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md), [ADR-0451](../repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), and [ADR-0479](../semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md)

## Context

The owner wants document normalization to run automatically without interrupting development. On 2026-10-25, it was stalled in several repositories:

- `lervo` (235 pending documents) and `digimon` (45) waited at `canonical_integration` with `waiting_authority/canonical_target_diverged`. Since ADR-0434 runs stages in order, one waiting draft blocked normalization, which comes after it.
- `digimon` had waited on the same obligation since 2026-10-12. The resident re-ran preflight about 20 times with the same result. The integration ref was five Lervo commits ahead of `HEAD`. Three of those commits created documents through root apply, but the working tree no longer had them. ADR-0449 synchronization returned `unchanged` whenever `HEAD` was an ancestor of the ref. Each new assessment then proposed creating one of those documents again, with `beforeHash: null`, against Lervo's own earlier bytes on the ref. Nothing could resolve this.
- `lervo` met the same stop after its Mac–WSL replica captured feature-branch edits to `advertised-commands.md`. The ref, `HEAD`, and the current working tree all held the same bytes. Only the reviewed preimage differed.
- Terminal turns reported `document_normalization_pending` as a lifecycle gate, and its instruction told every repository-changing turn to run normalization "whatever its task". This 2026-09-26 duty predates background convergence. It also conflicts with ADR-0450 and ADR-0451, which keep background knowledge out of developer flow. A pending count made the `Stop` inspection `action_required` and blocked declarations.
- Other stops, such as `axli` with `document_directory_file_capacity_exceeded` and `flemo` with `review_context_unavailable`, showed only through `lervo knowledge convergence status` on the owner host. No attention item reported them.

## Decision

### Park divergent canonical batches

When integration preflight finds draft targets whose integration-ref bytes differ from the reviewed preimage, and no normalization lineage explains the difference, the batch integrates nothing. The reviewer approved its drafts together, so integrating only some of them could break links between them.

- Each source with a `candidate` disposition is parked with reason `target_diverged`. A batch with no candidate parks all of its sources. For each of up to eight divergent targets, the parked source records the ref, the path, and the target's bytes on the ref, at `HEAD`, and in the reviewed working-tree preimage.
- Other decisions in the batch keep their coverage. The cursor advances to the next workset, or to normalization when no workset remains.
- The stage records `canonicalTargetParked: <assessmentHash>`. The canonical disposition ledger skips that event, so parked drafts never count as integrated.
- A later obligation readmits a `target_diverged` source when its source bytes change, as for any parked source. It also readmits the source when any recorded target's bytes change on the ref, at `HEAD`, or in the working tree. Committing the owner's edit, synchronizing the ref, or editing the target therefore retries it without an owner command.
- Lifecycle verification handles these sources like any other parked source. With all other work done, it ends in `attention_required/knowledge_sources_parked`, and owner status lists each one with its reason.

Preflight never overwrites target bytes it did not review.

### Return discarded drafts to committed bytes

When `HEAD` is an ancestor of the integration ref, synchronization looks at each path that only the ref changed. If the ref bytes are an integrated draft, root apply wrote them into the working tree. If the working tree no longer holds those bytes, the working branch discarded or rewrote them.

The working branch is authoritative. Synchronization writes one Lervo commit on top of the ref that sets those paths back to `HEAD`'s committed version, or removes them when `HEAD` has none. Drafts still waiting in the working tree for their commit stay. Bytes that are not exact integrated drafts, such as an owner commit, are never touched. The update is compare-and-swap on the ref's observed value.

### Make pending normalization attention, not a duty

`document_normalization_pending` becomes a terminal knowledge advisory: non-blocking attention that never gates a turn, a declaration, or a checkpoint. Its text says that background convergence normalizes these documents. It gives the manual command only for when the user asks to normalize now. Discord turns already receive normalization work only in synchronous knowledge mode, when no background owner runs, and that does not change.

### Report owner-host stops as attention

When this host owns convergence and its resident reports a degraded heartbeat, continuity inspection adds a `convergence_attention` finding. Its detail is the closed reason code, and its severity is `attention`. Event-schema holds keep their own finding. The item never blocks. Its remediation points to `lervo knowledge convergence status --json` and explains how parked sources are readmitted.

## State, events, privacy, and failure meaning

This decision adds no event type or stage state.

- The parked-source reason `target_diverged` and its `targets` field live in private stage data and in the `knowledge_sources_parked` dependency. Public events carry only existing codes.
- New obligations stop recording `canonical_target_diverged`. A stall recorded under the earlier evaluation contract is reevaluated once after deployment, per ADR-0485, and then parks.
- The synchronization commit carries Lervo's knowledge identity and names no source content.
- `convergence_attention` is a closed continuity finding code. Its detail is a closed reason code, never a path or message.

## Verification

Focused tests must show:

- A batch with a divergent target parks its candidate sources, integrates nothing, keeps coverage for its other decisions, and reaches normalization. The ledger does not treat its drafts as integrated.
- A carried `target_diverged` source stays parked while the source and the three target byte states are unchanged. A commit of the target, a ref move, or a target edit readmits it.
- A ref ahead of `HEAD` restores a discarded integrated draft to `HEAD`'s bytes and keeps a draft the working tree still holds. A ref-only owner commit leaves the ref unchanged.
- Pending normalization appears as a terminal advisory, not a lifecycle issue, and its text sets no per-turn duty.
- A degraded owner resident yields one non-blocking `convergence_attention` item. A non-owner yields none.

Installed verification must show `digimon` and `lervo` leaving `canonical_target_diverged` and reaching normalization without owner commands.

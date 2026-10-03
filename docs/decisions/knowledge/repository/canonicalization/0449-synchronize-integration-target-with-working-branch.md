# ADR-0449: Synchronize the integration target with the working branch

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md) and [ADR-0435](0435-continue-normalization-after-canonical-rejection.md)

## Context

Canonical integration commits each reviewed draft onto the delegated integration ref; root apply writes the same bytes into the working tree. The working branch commits those bytes separately, so the branches always diverge.

On the installed Mac, `refs/heads/lervo/knowledge-integration` had not followed the working branch since 2026-09-30. It held 24 ref-only commits, and 29 paths differed from `HEAD`: stale drafts, duplicate documents, and files later normalized or removed on the working branch. A draft for `assets.md`, created later on the working branch, stopped at `waiting_authority/canonical_target_diverged` because the ref lacked that file. This block recurs when a draft targets a document changed on the working branch after the ref last moved.

## Decision

- When a reviewed target preimage differs from the integration ref, preflight attempts one synchronization before recording `canonical_target_diverged`.
- If `HEAD` already contains the ref, fast-forward the ref to `HEAD`.
- If the branches diverged, check every path changed on the ref since the merge base. Each path's current ref bytes must exactly match an integrated draft from a `current` canonical integration that completed root apply. A deleted path or any other bytes leave the ref unchanged.
- If every ref-only change passes, record a merge commit with `HEAD`'s exact tree and parents `[ref, HEAD]`. Update the ref only if it still holds its observed value, preserving ref history.
- Recheck the target bytes. Remaining mismatches, including uncommitted working-tree edits, still wait.

## Failure and privacy

This decision adds no event, state, or failure code. Synchronization writes only the delegated integration ref; it never changes the working branch, working tree, or index. Commit metadata names no source content.

## Verification

Focused tests must show that synchronization:

- Merges `HEAD` with history preserved when every ref-only change was integrated.
- Leaves the ref unchanged when it holds unsettled bytes.
- Fast-forwards a ref that `HEAD` contains.

Installed verification must show a later draft integrating without manual ref repair.

# ADR-0129: npm Stage-Approval Reconciliation Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

Approval exit zero is not independent publication proof, while an unknown terminal reveals nothing about the outcome. Public registry and authenticated stage state must be observed together.

## Decision

A success or unknown terminal is rebound to its exact attempt, authorization, and review. Observations occur in this order: authenticated stage list, anonymous public version/dist-tag, then a second stage list. Both normalized stage lists must match. Raw target IDs are discarded; only `absent`, `present`, `replacement`, or `ambiguous` is retained.

The pure report returns `public_release_confirmed` only when public integrity, shasum, dist-tag, and absence of the approved stage all match. Complete public absence with the exact stage still present yields `approval_not_confirmed`. Partial, mismatched, or unavailable state yields `unknown`. No outcome authorizes retry or transition completion.

Sources, the store snapshot, and user configuration are rechecked, and temporary files are removed. The command changes no records, stage, npm settings, approval, or rejection.

## Consequences

Tests cover every outcome, stage/configuration races, raw-ID disposal, source binding, and rejection of redigested outcomes.

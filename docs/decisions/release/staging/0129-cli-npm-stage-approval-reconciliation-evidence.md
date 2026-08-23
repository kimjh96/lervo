# ADR-0129: npm Stage-Approval Reconciliation Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

Approval exit zero is not independent publication proof, while an unknown terminal says nothing about outcome. Public registry and authenticated stage state must be observed together.

## Decision

Success or unknown terminal is rebound to its exact attempt, authorization, and review. Observation order is first authenticated stage list, anonymous public version/dist-tag, then second stage list; both normalized lists must match. Raw target IDs are discarded, retaining only absent, present, replacement, or ambiguous.

The pure report returns public_release_confirmed only when public integrity, shasum, dist-tag, and absence of the approved stage all match. Complete public absence with the exact stage still present yields approval_not_confirmed; partial, mismatched, or unavailable state yields unknown. No outcome authorizes retry or transition completion.

Sources, store snapshot, and user config are rechecked; temporary files are removed. The command changes no records, stage, npm settings, approval, or rejection.

## Consequences

Tests cover every outcome, stage/config races, raw-ID disposal, source binding, and redigested-outcome rejection.

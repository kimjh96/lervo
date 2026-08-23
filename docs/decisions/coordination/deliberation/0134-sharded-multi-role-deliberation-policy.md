# ADR-0134: Policy-Defined Multi-Role Deliberation

- Status: accepted
- Decision date: 2026-08-21

## Context

Supporting more viewpoints requires declarative roles, providers, responsibilities, and rounds without code changes or append-only policy histories.

## Decision

Each policy lives at `.lervo/deliberations/<policy-id>.yaml` and contains schema/version, a matching ID, at most five rounds, required suites, and up to sixteen participants. Each participant defines role ID, name, perspective, Codex-or-Claude provider, and responsibility. Project ID and writing-contract hash are assembled from current sources at execution.

Exactly one proposal/decision role, one or more independent reviewers, and a distinct verification role are required, with both providers represented. Reviewers inspect the same latest claim independently in policy order. Any block returns all objections to the proposer; every reviewer must reapprove before verification and final decision.

The loader reads only regular no-follow files of at most 64 KiB beneath the actual project policy directory. It compares device, inode, size, and mtime before and after reading. Filename/ID mismatch, extra fields, duplicates, invalid responsibilities, and unsupported providers fail before execution.

One artifact emits `context.published` once for all audiences plus role-specific handoffs. Every subsequent role run creates fresh E2/E3 evidence. Cross-provider writing evaluation remains separate. Loading policy is application validation, not telemetry proving that a model loaded or used it.

## Consequences

`lervo deliberate --policy <id> <topic>` supports configurable expertise while preserving separate policy, state, artifact, and evaluation files. The topology remains proposal, multi-review, revision, verification, and decision; arbitrary graphs and external resume/start remain separate.

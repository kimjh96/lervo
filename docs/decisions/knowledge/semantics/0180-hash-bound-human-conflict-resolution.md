# ADR-0180: Hash-Bound Human Duplicate and Contradiction Resolution

- Status: accepted
- Decision date: 2026-08-23

## Context

Semantic conflicts were previously skip-only, preventing humans from choosing a canonical duplicate or publishing contradictory perspectives and their relationship. A disposition ID alone cannot bind the selected native action or existing concept identity.

## Decision

Each resolvable conflict provides deterministic `resolutionOptions` that bind `register_existing`, `create_generated`, `add_relation`, the selected existing concept, and compilation and subject coordinates through canonical JSON SHA-256.

The default remains `skip_only`. Only a policy explicitly created with `knowledge review-policy --allow-conflict-resolution` uses `hash_bound_resolution`. Humans select exact option hashes with `--resolve-item <disposition>=<sha256>`. Review CAS preserves every `resolve_conflict` approval; events retain only the existing aggregate approval digest.

Materialization recomputes the plan from current sources, candidates, and registry, and accepts an option only when its hash matches exactly. A source-backed duplicate group may accept at most one concept. A contradiction relation requires both endpoint concepts to be selected in the same review. Selecting one endpoint, both without a relation, or neither remains an explicit human disposition. Lervo never infers truth.

Options bind exact existing identities. Competing patches to one managed block remain skip-only because no safe combined output can be prebound. Resolution produces `human_reviewed` only—never verified, consensus, freshness, or provider agreement.

A missing policy or hash, duplicate over-selection, or absent endpoint rejects the entire review. Changed inputs produce `knowledge_plan_stale` with no partial apply. Reviewer identity and content or path details remain in owner-only CAS, not events.

## Consequences

CLI fixtures reject conflict choices under the default policy and reject duplicate over-selection. They then materialize one duplicate plus two contradictory concepts and their relation using exact hashes. Existing managed-block and safe-item approval contracts remain effective.

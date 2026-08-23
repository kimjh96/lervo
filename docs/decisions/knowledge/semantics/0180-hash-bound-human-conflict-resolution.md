# ADR-0180: Hash-Bound Human Duplicate and Contradiction Resolution

- Status: accepted
- Decision date: 2026-08-23

## Context

All semantic conflicts were skip-only, preventing humans from selecting a canonical duplicate or publishing contradictory perspectives and their relation. Accepting only a disposition ID would not bind the chosen native action or existing concept identity.

## Decision

Each resolvable conflict contains deterministic resolutionOptions binding register_existing, create_generated, add_relation, selected existing concept, and compilation/subject coordinates through canonical JSON SHA-256.

Default policy remains skip_only. Only a policy explicitly created with knowledge review-policy --allow-conflict-resolution uses hash_bound_resolution. Humans select exact option hashes with --resolve-item <disposition>=<sha256>. Review CAS preserves all resolve_conflict approvals; events retain only the existing aggregate approval digest.

Materialization recomputes the plan from current sources/candidates/registry and uses an option only on exact hash match. Source-backed duplicate groups may accept at most one concept. A contradiction relation requires both endpoint concepts selected in the same review; choosing one, both without relation, or neither remains an explicit human disposition. Lervo never infers truth.

Options bind exact existing identities. Competing patches to one managed block remain skip-only because no safe combined output can be prebound. Resolution yields human_reviewed only, never verified, consensus, freshness, or provider agreement.

Missing policy/hash, duplicate over-selection, or absent endpoints rejects the whole review; changed inputs produce knowledge_plan_stale and no partial application. Reviewer identity and content/path details remain owner-only CAS, not events.

## Consequences

CLI fixtures reject conflict choices under default policy and duplicate over-selection, then materialize one duplicate plus two contradictory concepts and their relation using exact hashes. Existing managed-block and safe-item approval contracts remain.

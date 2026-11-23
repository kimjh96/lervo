# ADR-0627: Renew assignment leases during long verification

Status: `accepted`
Decision date: 2026-09-29

## Context

The installed version-nine normalization apply reached all four test shards. Shard four failed one complete canonical-workset journey at its explicit 90-second deadline, then reported a cleanup error. Its writer assignment was claimed at 15:07:28 UTC with a 30-minute lease ending at 15:37:28 UTC; the shard ended after expiry. Failure bookkeeping could no longer complete the exact assignment, so the outbox recorded `knowledge_job_transient_failure` instead of a settled stage result. The separate 60-minute stage lease remained current.

## Decision

Keep the agent-workforce maximum assignment lease at 30 minutes. While its own stage lease remains current, a convergence stage renews its exact assignment claim every ten minutes. Renewal preserves the lease ID and generation through the existing `assignment.lease.renewed` transition. Before reusing an active claim with less than 20 minutes remaining, renew it once. Stop and await any in-flight renewal before assignment completion or failure bookkeeping. Failed renewal causes the stage authority check to fail and cannot authorize a write or successful receipt.

The complete canonical-workset test now allows 240 seconds and retains every source, review, currency, and idle-repeat assertion. The 1,800-second command limit per full-test shard and the 60-minute stage lease remain unchanged. These bounds cover the observed busy-host case without expanding generic workforce lease authority.

## Evidence, privacy, and limits

The existing `assignment.lease.renewed` event records assignment ID, agent ID, lease ID, generation, and expiry. It contains no source text, provider payload, or credential. An absent, expired, or conflicting exact lease retains `assignment_lease_conflict` and cannot settle an assignment. A source or stage lease change still prevents renewal and settlement. No new public event or state is introduced.

Focused tests cover repeated renewal, stopping before settlement, renewal failure propagation, and the complete canonical-workset journey. Installed proof still requires a current four-shard result and an applied normalization receipt. The expired prior assignment and its transient outbox failure remain historical evidence; this change does not relabel that attempt as success.

## Responsibility review

The convergence workforce module composes registration, exact assignment authority, and settlement. A separate lease module owns only the bounded renewal timer; the agent-workforce package retains ownership of lease validation and durable renewal. The canonical-workset test retains one cohesive end-to-end fixture; only its deadline changes.

## References

- [ADR-0626](0626-cover-busy-host-verification-stage-leases.md)
- [Background convergence runtime](../../../specs/background-knowledge-convergence/runtime.md)

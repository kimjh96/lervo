# ADR-0609: Renew unchanged policy snapshots on the Hub

Status: `accepted`
Decision date: 2026-11-22
Amends: [ADR-0043](../../execution/verification/0043-signed-policy-and-command-bound-approval.md) (snapshot expiry)

## Context

ADR-0043 gives each signed policy snapshot an expiry, and an expired snapshot closes remote commands on the Node. Nothing renewed a snapshot, so a person had to ask the Hub to re-sign the same rules every 30 days. That request was missed twice for the Lervo project. Sequence 5 expired on 2026-10-09 and was renewed by hand on 2026-10-11. Sequence 6 expired on 2026-11-10, and WSL remote control reported `invalid_policy_bundle` for 12 days until a manual renewal on 2026-11-22. The rules never changed, so each outage came from bookkeeping, not from a policy decision.

Expiry guards against a missing or stale Hub. A running Hub that still holds the owner's last rules is the current policy. Under [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), Lervo should not wait on a person for an effect it can make itself and report.

## Decision

### The Hub re-signs each due head with the same rules

The Hub runtime runs one renewal cycle when its server starts listening. For each project's current snapshot, the cycle signs a successor with the same target and rules. The successor's validity equals the current snapshot's own `expiresAt - issuedAt`, so the owner's chosen term carries forward. The successor names the observed head as predecessor. Publication already rejects a successor whose predecessor is no longer the head, so an owner change made during the cycle wins, and the cycle skips that project.

A head is due 72 hours before it expires. An already expired head is due at once, because a running Hub with unchanged rules is still the owner's policy.

### A live approval delays renewal to its last hour

An approval binds the exact snapshot and cannot outlive it. Re-signing would orphan an approval that is still unexpired and unrevoked. While such an approval binds the head, the head becomes due only 1 hour before expiry, so renewal cuts an approval short by at most that hour.

### The cycle sleeps until the next due head

After a cycle the lifecycle sets one timer for the earliest due head, at most 24 hours away, so a newly published policy is still seen within a day. There is no polling loop. A failed cycle is reported on the Hub's stderr and retried after 1 hour, well inside the 72-hour lead. A renewal failure never stops the Hub: remote commands close only when a snapshot actually expires. Closing the Hub stops the timer and waits for a running cycle before the store closes.

### Contract

- `@lervo/hub-policy` exports `renewDuePolicySnapshots`, `policyRenewalDueAt`, `POLICY_RENEWAL_LEAD_MS` and `POLICY_RENEWAL_APPROVAL_GRACE_MS`, plus the `HubPolicyRenewalSource` port. Its `listPolicyRenewalHeads(at)` returns each head with `liveApprovalCount`.
- `HubSyncSQLiteStore.listPolicyRenewalHeads` reparses every head and approval against its snapshot, so a corrupt source fails the cycle instead of renewing it.
- `@lervo/hub` exports `attachHubPolicyRenewalLifecycle`; `openHubRuntime` attaches it for both HTTP and TLS servers.
- No event, table or wire format changes. A renewal is an ordinary snapshot publication with the next sequence.

## Consequences

- A rule change still needs an authorized `POST /v1/policy/projects/<project>/snapshots`. Only unchanged rules renew themselves.
- A Hub that stays down past expiry still closes remote commands, as ADR-0043 requires. The first cycle after restart renews the expired head.
- Each renewal adds one snapshot row per term, which is 12 rows a year for a 30-day policy.

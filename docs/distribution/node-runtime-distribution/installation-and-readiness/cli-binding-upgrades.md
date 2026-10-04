# Guarded Node CLI binding upgrades

Status: `active`
As of: 2026-09-28

## Exact configuration scope

An explicitly supplied `--configuration-source` may make one of two mutually exclusive changes within the running Node's existing configuration path:

- Replace configured deliberation `cliExecutable` references and the supervised `managedExecution.cliBundle` reference.
- Add one channel binding to one Discord identity. The channel must already belong to another identity in the same configuration with the same tenant key, conversation key, and conversation ID. The receiving identity must already allow the guild and have fewer than eight channels.

The candidate must be an owner-only, no-follow regular file no larger than 1 MiB. All other fields—including repository, provider, role, policy, supervision, and credential coordinates—must remain equal. Each replacement CLI must be an existing real owner-controlled executable. The transition grants no project delegation or writer authority beyond the one reviewed channel.

For an organization-bound agent, the candidate also changes the durable external-agent deployment hash. While the old Node is stopped under the same work freeze, the operator must update that deployment and its channel membership, then restore the old deployment if replacement activation fails. The configuration adapter alone does not make this canonical event change. Preflight the candidate against the updated organization record before claiming readiness; service-manager `active` alone is insufficient.

Keep the existing supervision owner leases and work freeze held. Only after verified service inactivity may the adapter replace configuration bytes and compare-and-swap the exact frozen configuration digest. The admission store requires the same live freeze owner and no remaining Node session. A new Node may register the replacement digest, but work must wait until release. If activation fails, restore original bytes and digest before restarting the exact predecessor. Stable service activation determines the manager result.

## Private journal and failure

Each configuration has one owner-only `.cli-predecessor` backup and `.cli-transition.json` journal retaining the exact original bytes and a bounded version-1 coordinate: `schemaVersion`, `originalDigest`, `replacementDigest`, and `state`. Retain these historical filenames so interrupted CLI transitions cannot be bypassed.

States are `prepared`, `applying`, `applied`, `restoring`, `restored`, and `completed`. `restored` proves byte and admission-binding restoration, not organization membership or service readiness. `completed` follows stable service activation.

Configuration bytes remain private and must appear in no event or public output. The backup shares the configuration's 1 MiB limit. Replace completed records rather than appending them. Never overwrite existing unowned backup bytes.

Interrupted apply or restore retains `service_upgrade_unknown` and cannot replay. An exact still-prepared record may be reused only before configuration effects. Lost binding, source drift, unsafe bytes, or journal failure cannot claim completed activation.

## Verification

- Cross-connection tests reject a live original session, wrong freeze, and stale digest; permit replacement only after stop; and hold replacement and restored work until release.
- Manager composition tests observe frozen successful activation and exact predecessor restoration after replacement failure for deliberation and supervised CLI references.
- Adapter tests retain interrupted journal ownership, reject configuration authority expansion, permit exactly one already shared channel binding, preserve source drift, and reject unsafe candidate permissions.

See [ADR-0164](../../../decisions/operations/services/0164-user-runtime-service-management-boundary.md) for service authority and the predecessor contract, and [installation](installation-and-activation.md) for the operator sequence.

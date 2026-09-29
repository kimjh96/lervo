# Guarded Node CLI binding upgrades

Status: `active`
As of: 2026-09-28

## Exact configuration scope

An explicitly supplied `--configuration-source` may replace configured deliberation `cliExecutable` references **or** add one channel binding to one Discord identity within the running Node's existing configuration path. These are separate, mutually exclusive changes. The channel must already be bound to another identity in the same configuration with the same tenant key, conversation key, and conversation ID; the receiving identity must already allow that guild and have fewer than eight channels. The candidate is an owner-only, no-follow regular file bounded by 1 MiB. All other fields, including repository, provider, role, policy, supervision and credential coordinates, remain equal. Each replacement CLI is an existing real owner-controlled executable. This transition grants no project delegation or writer authority beyond that one reviewed channel.

For an organization-bound agent, the candidate also changes the durable external-agent deployment hash. An operator must update that deployment and its channel membership while the old Node is stopped under the same work freeze, then restore the old deployment if replacement activation fails. The configuration adapter alone does not make that canonical event change. Preflight the candidate against the updated organization record before claiming readiness; a service-manager `active` result alone is insufficient.

The existing supervision owner leases and work freeze remain held. Only after verified service inactivity can the adapter replace configuration bytes and compare-and-swap the exact frozen configuration digest. The admission store requires the same live freeze owner and no remaining Node session. A new Node can register the replacement digest, but work waits until release. Activation failure restores original bytes and digest before restarting the exact predecessor. Stable service activation determines the manager result.

## Private journal and failure

One owner-only `.cli-predecessor` backup and `.cli-transition.json` journal per configuration retain the exact original bytes and a bounded version-1 coordinate: `schemaVersion`, `originalDigest`, `replacementDigest`, and `state`. The historical filenames remain so an interrupted CLI transition cannot be bypassed. States are `prepared`, `applying`, `applied`, `restoring`, `restored`, and `completed`. `restored` proves byte and admission-binding restoration, not organization membership or service readiness. `completed` follows stable service activation.

Configuration bytes remain private; no event or public output contains them. The backup has the configuration's 1 MiB limit, and completed records are replaced rather than appended. Existing unowned backup bytes cannot be overwritten. Interrupted apply or restore retains `service_upgrade_unknown` and cannot replay. An exact still-prepared record may be reused only before configuration effects. Lost binding, source drift, unsafe bytes or journal failure cannot claim completed activation.

## Verification

Cross-connection tests reject a live original session, wrong freeze and stale digest, permit replacement only after stop, and hold both replacement and restored work until release. Manager composition tests observe frozen successful activation and exact predecessor restoration after replacement failure. Adapter tests retain interrupted journal ownership, reject configuration authority expansion, permit exactly one already shared channel binding, preserve source drift, and reject unsafe candidate permissions.

See [ADR-0164](../../../decisions/operations/services/0164-user-runtime-service-management-boundary.md) for the service authority and predecessor contract, and [installation](installation-and-activation.md) for the operator sequence.

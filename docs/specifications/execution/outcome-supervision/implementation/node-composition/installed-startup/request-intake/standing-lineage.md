# Standing lineage

When configuration selects `outcomeSupervision.standing`, the named binding is a lineage root and intake first resolves its latest verified successor.

## Lineage resolution and service rebinding

The walk verifies derivation on each successor's creating installation, then follows that successor's latest installed mandate. It follows a reviewed later mandate version for a running goal rather than rejecting it.

After each owner cycle, a running service scans for such an installation and rebinds without restarting. This lets an operator widen a stuck goal's ceilings while its owner keeps running.

A running standing service also scans new events after every owner cycle, including a failed cycle on the settled goal, for the next successor installation under its root grant. If another process, such as the local command, started that successor, the service rebinds to the verified lineage head without restarting.

## Successor admission

Binding under an active goal is unchanged. A request with another origin on an active goal remains an `origin_conflict` refusal.

When the current goal is settled and its current mandate still carries `successorAuthority`, the same intake starts the next goal before binding:

1. Record a successor workstream whose objective is the request text.
2. Install the derived mandate `<parent>.s<n>` under the successor's own owner fence.
3. Append `work.supervision.bound` under the new binding and tell the running service to follow it.

The transition returns `workstream_inactive` when the goal is not settled or the grant is exhausted. It uses existing typed refusals and adds no event type.

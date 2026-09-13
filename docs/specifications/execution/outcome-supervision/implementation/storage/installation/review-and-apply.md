# Review and apply

```text
lervo agent mandate host --json
lervo agent mandate plan --from mandate.json --supervision supervision.project --reviewer user.founder --json
lervo agent mandate install --from reviewed-plan.json --approve <approval-hash> --reviewer user.founder --write --json
lervo agent mandate inspect --supervision supervision.project --json
lervo agent mandate revoke --supervision supervision.project --workstream <workstream-id> --mandate-hash <hash> --installation-event <event-id> --reviewer user.founder --write --json
```

The plan command returns the complete reviewable plan. Save those exact bytes as installation input. The local caller explicitly supplies the appointing reviewer and exact approval hash. This is local repository-owner review, not remote identity authentication or automated topology policy review. Planning does not install authority.

The plan hash binds the full mandate, reviewer digest, supervision identity, source observations, and predecessor installation or revocation event.

Source observation validates the registered owner's active team membership and exact role coordinates, role and capability package integrity, bounded parent ancestry, capability ceiling, path scope, and provider scope. The source digest also binds the workstream snapshot, team policies, role definitions, ancestry records, current data policy, and writer coordinate. Role `require_approval` decisions retain independent permission gates; installation cannot turn them into `allow`.

Apply acquires the durable supervision owner lease and re-observes these sources before and after asynchronous CAS persistence. Installation rejects changed sources, observations taking over five seconds, invalid history, missing snapshot evidence, expired mandates, mismatched reviewers, stale predecessors, unsafe lease storage, or lost ownership. Event commit checks the predecessor under the same owner fence.

Installation supplies evidence for later admission. The effect adapter must still verify live authority at its own commit boundary.

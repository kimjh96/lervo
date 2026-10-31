# Repository workstreams

## Replication and divergence

The replicated lineage is the workstream bound to the default branch. Node reads it from recorded history whatever branch the checkout projects, and an import rewrites the projection only when the checkout projects that lineage. Branch-bound workstreams stay local ([ADR-0526](../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md)).

Workstream revisions are shared by project and repository identity across authorized destination registrations. Requests bind registration, repository identity, exact current and previous snapshot hashes, and bounded snapshot bytes.

Node validates local ancestry and reads the Hub head set. When a local ancestry match is proved, Node publishes the missing suffix; otherwise, it republishes available ancestry idempotently.

The Hub retains at most 16 append-only heads and returns exact snapshot bytes only for a unique head. Divergence is observable; no head is automatically selected or merged. Node imports only a newer unique head through CAS, the lazy projection, and a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.

## Permissions and exclusions

Replication requires separate `workstream.read` and `workstream.write` permissions. It excludes legacy source bodies, prompts, transcripts, credentials, signatures, and approval grants. Pending approval descriptions remain unresolved state and confer no authority.

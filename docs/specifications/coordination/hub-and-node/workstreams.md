# Repository workstreams

## Replication and divergence

Workstream revisions are shared by project and repository identity across authorized destination registrations. Requests bind registration, repository identity, exact current and previous snapshot hashes, and bounded snapshot bytes.

Node validates local ancestry, reads the Hub head set, and publishes the missing suffix when a local ancestry match is proved. Without a match, it republishes available ancestry idempotently.

The Hub retains at most 16 append-only heads and returns exact snapshot bytes only for a unique head. Divergence is observable and never automatically selected or merged. Node imports only a newer unique head through CAS, the lazy projection, and a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.

## Permissions and exclusions

Replication requires separate `workstream.read` and `workstream.write` permissions. It excludes legacy source bodies, prompts, transcripts, credentials, signatures, and approval grants. Pending approval descriptions remain unresolved state and confer no authority.

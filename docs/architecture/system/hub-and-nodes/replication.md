# Workstream and event replication

Bounded workstream revisions replicate separately from event streams, keyed by project and repository identity. Authorized nodes see the same append-only head set. Each event-producing node uses a distinct destination coordinate because each destination owns one canonical hash chain.

A node reads the bounded Hub head set and publishes only the missing suffix after proving a local-ancestry match. Without a proven match, it uses idempotent full-ancestry publication. It imports only a newer unique head through CAS, projection, and a system event, and exposes divergence without choosing a winner. Pending approvals transfer only as unresolved state, never authority.

Local event producers do not know Hub endpoints or device credentials. When policy permits and a Node selects a destination, it authenticates registration, checks the Hub cursor against local truth, and durably reconciles the next bounded event prefix into that destination's outbox.

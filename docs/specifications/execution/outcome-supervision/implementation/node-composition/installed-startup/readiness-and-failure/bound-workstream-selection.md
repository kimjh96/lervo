# Bound-workstream selection and evidence

Bound-workstream selection reads the latest exact snapshot event and content-addressed artifact for the mandate's workstream ID and verifies contiguous locally recorded revisions. Only an exact, artifact-verified `hub_replication_import` checkpoint may bridge revisions not transferred by Hub replication. When that workstream is selected, selection also checks its selected projection.

Completion and standing succession of an unselected goal append their own snapshot event without replacing another workstream's selected projection or pending approval.

A missing artifact, forked chain, unexplained gap, stale predecessor, changed mandate, or shared workforce conflict fails before the effect.

The snapshot event retains its existing bounded IDs, hashes, revision, status, and timestamp. No new event type, credential field, or Discord message body is introduced.

Local tests alone neither prove installed parallel operation nor clear a conversation deployment approval.

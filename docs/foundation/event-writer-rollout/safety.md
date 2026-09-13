# Safety boundary

Envelope version 2 or 3 writing is repository-local, off by default, and selected only by the Lervo-managed `.lervo/data/event-contract.json` coordinate. A missing coordinate selects version 1. Activation affects future writes only and never rewrites event history. Activation commands default to version 2.

Version 3 requires `--schema-version 3` on both plan and apply commands and current authoritative evidence that every required reader supports versions 1, 2, and 3. Local-only activation also re-observes the local reader before planning and applying version 3. A version 2-only Hub or Node blocks version 3 activation. The version 3 coordinate uses schema version 2 and binds the target version into its activation identity; existing version 2 activation identities remain unchanged.

Before activation, every process that can read the repository event chain must use a version 2-capable reader. Once a version 2 event exists, mixed history makes version 1-only readers unsafe even after writer rollback to version 1. Readers must remain version 2-capable through rollback.

Once a version 3 event exists, all readers must continue supporting versions 1, 2, and 3 through rollback. A default version 2 activation request never downgrades an existing version 3 selection; use explicit rollback to select version 1. Version 3 selection accepts explicit supervision events while preserving existing lower-version draft behavior. Selection does not install a mandate or start Node supervision.

For Hub-enabled repositories, the owner-only repository Node fleet registry is the configured membership authority. The installed service definition locates the Node config. Required remote observations are fresh identity-bound Node health and the configured Hub capability endpoint. Do not disable Hub synchronization to bypass this gate.

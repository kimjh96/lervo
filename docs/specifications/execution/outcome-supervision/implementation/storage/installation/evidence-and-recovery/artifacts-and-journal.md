# Artifacts and journal

`work.supervision.mandate.installed` references separate `mandateArtifactHash` and `installationReviewHash` CAS byte hashes. `mandateHash` is the operating contract hash; it must not be assumed to be a CAS address.

Recovery verifies raw CAS bytes and exact plan, mandate, event, predecessor, owner, revision, and cause bindings. Missing or corrupt artifacts block recovery. Events contain bounded identifiers and hashes. Mandate paths, limits, and reviewer source material remain in governed CAS artifacts under existing artifact access and retention rules.

`SupervisionMandateJournal` projects the latest installed mandate and its `revoked` boolean from the bounded canonical supervision stream. Results include installation event ID, latest authority event ID, mandate, mandate hash, installation review hash, and source revision digest. Read-only inspection requires no owner lease and does not establish current admission.

Installation replay returns the existing active receipt. An older installation cannot replace its successor or undo revocation. Successors require the same mandate ID and appointing authority with a strictly later version.

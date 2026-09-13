# Compatibility and verification

Envelope version 3 introduces eight supervision event types with exact payload version 1 allowlists. Writer version 1 remains the default. Repository activation selects version 2 by default or version 3 with `--schema-version 3`. Version 3 requires fresh authoritative readers capable of versions 1, 2, and 3, an exact reviewed plan, and explicit apply. Reader advertisement alone grants no writing authority. Old envelopes and exact stored replays retain their bytes.

Focused tests cover:

- Independent SQLite connections.
- Expiry without takeover.
- Renewal and stale-owner rejection.
- Failed commits.
- Durable plan recovery.
- Duplicate observations.
- Unavailable artifacts.
- Malformed review binding.
- Missing or pre-decision effect evidence.
- Irreversible confirmation.
- Version 1/2 writer rejection.
- Explicit version 3 activation, current reader revalidation, recovery, and rollback.
- Reviewed local mandate installation, separate CAS hashes, fresh-source rejection, successor ordering, and idempotent revocation.
- Concurrent installation rejection and lost-owner fencing after asynchronous persistence.

Runtime tests cover source changes and revocation while an effect remains uncertain. These tests do not establish installed autonomous hiring, orphan-owner recovery, provider readiness, or production Node activation.

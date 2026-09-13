# Designated execution authority

`OperatingMandateV2` preserves the mandate's resource, role, path, review and revocation limits and adds an exact `executionAuthority` object: `schemaVersion: 1`, `mode: designated_host`, and `hostIdentityHash`. Reviewed installation binds this object into the mandate contract hash. Version 1 remains strict and local-only; an optional field cannot enable this behavior.

The designated host may supervise its verified local repository history while Hub synchronization is enabled. Every authority observation must match the current host to the reviewed designation. Other hosts reject installation and execution admission even with copied repository bytes or mandate events. Successful transport establishes neither authority nor reconciliation of divergent histories. AXLI can use a separately designated execution side without claiming Mac/WSL history convergence.

## Observation and privacy

`lervo agent mandate host --json` reads host identity without changing repository state. The adapter hashes a versioned contract identifier, OS platform, current hostname and machine identity. Linux reads a bounded regular `/etc/machine-id` without following a final symlink and rechecks its metadata. macOS uses a bounded, five-second `ioreg` observation of the platform UUID. Unsupported systems, malformed identities and changed hostnames reject observation.

Only the version and hash leave the adapter. This operation does not write raw hostnames or machine identifiers to mandate events, artifacts or tracked documents. The hash identifies the observed OS configuration. It is not cryptographic remote attestation and does not defend against an administrator cloning or replacing the underlying machine identity.

## Installation and succession

The ordinary exact mandate plan/apply flow reviews the designation. It still requires the selected version 3 writer, verified event chain, active team/owner/role ancestry, canonical workstream and durable owner fence. The current designation observation participates in the source digest. This grants no additional capabilities, starts no provider and does not automatically activate a Node.

An active version 1 mandate must be revoked before upgrading its lineage to version 2. Once designated, later versions cannot change the host hash or downgrade to version 1, even after revocation. Moving execution requires a separately verified transfer protocol; editing the hash cannot prove the old host stopped. Canonical journal recovery and installation both enforce these succession rules.

Revocation remains available on the designated host after owner suspension or mandate expiry, using the exact installation event, mandate hash and appointing reviewer. An unresolved owner lease still blocks mutation. Revocation is not claimed to stop an already-started external effect.

Tests cover Hub-enabled installation and execution on the observed host, wrong-host rejection, strict versioned fields, required legacy revocation, immutable designation and canonical revocation. Production reader rollout, concrete effect admission and installed acceptance remain required before activation.

# Storage and privacy

Plans and responsibility artifacts contain bounded human-readable material and paths and belong in governed CAS. Review and report values contain bounded IDs, hashes, dispositions, reason codes, and dates. They exclude prompts, credentials, provider output, and external message identifiers.

The concrete decision journal writes envelope version 3 through an explicitly enabled SQLite writer. Production repository writer activation remains unchanged. [Durable storage](../storage.md) defines privacy, fencing, bounds, and remaining recovery work.

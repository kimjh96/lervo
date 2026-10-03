# Bounded Publication Lifecycle

Navigation obeys entry and UTF-8 byte limits. New topics create files; empty categories create no paths.

Refresh computes the complete desired set and deletes obsolete output only when the prior generation records its current hash. Edited or unrecorded output conflicts. Cleanup removes empty generated parents.

`.lervo/state/knowledge/current/structural/manifests/current.json` records structural ownership. Refresh replaces it and deletes exact-hash legacy structural manifests and structural outputs during schema-2 migration, preserving semantic manifests and immutable review and evidence.

# CLI adapter checks

`apps/cli/src/mandate-installation.ts` implements this adapter boundary. Controller, source-observer, and journal internals remain responsible for their separate contracts.

## Work-scope selection and planning

Work-scope selection uses an explicit workstream ID or the verified current snapshot's ID; absence is an error. It reads event-source pages of 1,000, rejects populations above 32,768 events, and passes all collected events and repository assignments to `selectOperatingWorkScope`. It does not infer scope from prose.

Planning clones and validates the mandate, observes its active installation source, reads previous journal state, and delegates plan construction. Schema-3 mandates pass their bound work-scope workstream ID to the source observer; other schemas supply no override.

## Installation and inspection

Installation clones and validates the plan. The reviewer must equal the mandate's appointing authority; approval must equal the exact plan approval hash. It acquires a 300,000 ms supervision-owner lease; acquisition failure requires reconciliation. Before installation, fresh source observation must hash identically to the planned source and take at most 5,000 ms. Journal installation receives the same revalidation callback and lease fence. Finally blocks release leases and opened stores. The adapter does not establish journal transaction or replay semantics.

Inspection selects an explicit or current workstream ID and reads journal state. Its fallback revision and placeholder owner are read coordinates, not a new appointment or execution grant.

## Revocation

Revocation requires event writer version 3 or later and an installed mandate. It acquires the installed owner's lease, reloads the project manifest, checks repository identity, observes mandate execution authority using the current Hub-sync setting, and delegates revocation to the fenced journal with the installed event's workstream revision. Reviewer authorization and exact revocation binding remain journal responsibilities.

## Preflight resolution

Preflight resolution requires event writer version 3 or later and a current, non-revoked installation. Without approval, it returns the journal's exact review and contract hash. With approval, it acquires the owner's lease and delegates resolution of the blocked event, reviewer, and approval to the fenced journal. A returned review alone is neither a resolution event nor execution authority.

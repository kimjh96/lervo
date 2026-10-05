# Resource and fairness bounds

Initial activation uses finite reviewed ceilings: 1,024 outstanding obligations per repository, one active provider call per repository, and two background calls across the installed host. Live work has priority. A repository without a host arbiter cannot claim a fleet-wide ceiling; co-resident standalone CLI workers use the same host arbiter.

Each scheduling cycle advances at most eight stage jobs. A normalization batch selects at most eight documents, 1 MiB of source, and eight total provider calls, including fallback and regeneration. Preflight may select fewer documents; capacity is conservative, not a token prediction. Keep measured tokens, unavailable usage, and elapsed time separate from deterministic candidate identity. Token/spend ceilings come from the reviewed delegation; missing usage blocks the next admission when such a ceiling requires it.

Transient stages retry at most 16 times with exponential delay from one minute to one hour. Provider quota/authentication failures pause affected provider admission and expose a bounded reason instead of consuming repeated document attempts. Reset times come only from a normalized provider observation; an unknown reset requires refreshed evidence. Provider switching requires existing authority and newly bound output review.

Selection combines stage dependencies with oldest-ready work and a rotating cursor across source families. Rejected or oversized families remain visible without permanently blocking the leading batch. Source edits coalesce to a newer snapshot after a 30-second quiet period, with a 60-second maximum wait. Completion requires finite stable input and available provider capacity; unlimited edits cannot be promised convergence.

A cycle makes no provider request when debt is zero, no stage is due, or authority/capacity is unavailable. Sleep until the next exact due time or event. Health reports host liveness, debt counts, oldest age, active stage, wait reason, and last verified currency separately. `ready` for transport never means knowledge current.

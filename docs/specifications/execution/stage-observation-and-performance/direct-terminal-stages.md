# Direct-terminal stages

Direct hooks measure only Lervo-owned ingress, repository discovery, lifecycle inspection, corpus preparation, query projection, repository snapshot, search, exact loading, context assembly, event commit, and total. Catalog version 2 names the current provider projection stage `query_projection`; `projection_admission` remains only to keep catalog version 1 evidence readable.

A current direct projection includes capability-free runner startup and one query-producing provider turn, without a separate synthetic readiness turn. Direct hooks do not observe the provider turn outside the hook.

## Scan and cache reuse

Terminal lifecycle inspection may reuse one exact prepared repository-knowledge scan across its read-only compiler checks. Its knowledge-only result may be retained as a rebuildable local cache bound to the CLI version, repository snapshot revision, and supplemental-source digest. An active materialization transaction, any coordinate mismatch, invalid state, or technical inspection failure prevents reuse. Cache reuse changes neither lifecycle findings nor evidence meaning.

The current direct-terminal environment profile leaves cache state `unknown`; timing reports therefore do not infer warm or cold cohorts from cache behavior.

A changed root declaration verifies its knowledge disposition and prepares that exact cache before its event is accepted. Stop evaluates cheap required coordinates first, skipping the full knowledge scan when an unchanged or already non-current turn cannot benefit from it. Prompt preparation reuses one configured scan across instruction and search consumers.

## Projection and evidence

Provider query projection loads only its workstream and publication-language prerequisites while corpus preparation and repository snapshotting run concurrently. The joined result is rejected if independently observed project or publication-language coordinates disagree. Each materially changed measured implementation has a distinct hook build digest in its environment profile; reports retain rather than merge older cohorts.

A version 1 writer skips version 2 stage evidence and preserves the documented availability-safe hook result. A version 2 writer stores the profile in local CAS and appends a system-authored event. Measurement or persistence failure records no false success and leaves coverage partial or unavailable; it does not erase or reinterpret a valid context or turn event. Projections reject duplicate hook sets and cross-session joins and never add durations across environment profiles.

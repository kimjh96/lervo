# Operational resolution

The operational plan resolver first checks an explicit local selection. Without one, it:

1. Resolves the shipped product qualification.
2. Rebuilds the current repository-knowledge Markdown corpus.
3. Verifies registered engine and projector builds.
4. Executes independent queries through `SearchEnginePort`.
5. Fuses validated coordinates.
6. Maps selected paths to current concepts.

A different local candidate still reads a content-bound bundle from `.lervo/search-retrieval-plan-bundles`, verifies immutable transitions, and requires its exact reviewed corpus. A legacy activation of the exact product-default plan no longer pins the current corpus to that historical review.

Both v2 and the v1 rollback baseline remain local and require neither a Hub nor a provider credential.

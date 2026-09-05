# Deliberation publication failure

`deliberation.artifact.publication_failed` retains deliberation, role, producer provider, semantic-evaluator provider, round, attempt, artifact ID and content hash, repository-verification status, writing-publication failure, recovery state, bounded failed or missing check IDs, semantic-evaluation status, and repair limit.

It excludes provider output, prompts, transcripts, source bodies, paths, unrestricted errors, and credentials.

The event means the provider result remains quarantined in CAS and recoverable with `lervo deliberate artifact --content-hash`; it is not a published deliberation artifact. Repository verification and writing publication remain independent facts.

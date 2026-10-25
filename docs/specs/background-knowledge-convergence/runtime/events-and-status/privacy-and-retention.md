# Privacy and retention

Public events expose only bounded IDs, hashes, counts, timestamps, and normalized codes. Source paths and bodies, prompts, candidate prose, reviewer rationale, absolute paths, credentials, and native errors remain in owner-only private CAS or private projections.

Assignment failure proofs may retain a bounded native cause name, code, and message in private CAS for diagnosis.

Private context-selection evidence records at most 64 skipped optional reads as repository-relative paths and closed reasons. Private stage and assignment failures carry `documentPath` and `documentReason` when available. Loaded bindings exclude skipped documents. Public events carry only existing failure codes and evidence hashes; [ADR-0532](../../../../decisions/knowledge/maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) defines these fields and their failure meanings.

Verification failure after provisional document publication rolls back the document and retains `knowledge_verification_failed` as the public failure code. A generic apply error is reserved for an untyped publication or event-recording failure.

Scheduling rows retain at most 1,024 acknowledged entries or seven days. Pruning never deletes canonical events or referenced CAS proof. Current replay projections retain active obligations and the last verified currency.

# Integrated draft evidence

The disposition ledger reads event pages of at most 1,000 entries and considers only `repository.knowledge.stage.recorded` events with stage `canonical_integration` and state `current`. It loads referenced private input only when its SHA-256 matches; missing or unreadable input is skipped. It then requires matching obligation and project coordinates, an approving assessment hash, ordered source and draft hashes, the baseline policy hash, and a reviewer different from the generator.

Eligible source decisions exclude `needs_review` and must match a batch source's path and hash. Integrated drafts have separate entries keyed by path and exact output hash, retaining the replaced preimage. These entries rely on the producer's meaning of a current integration; the reader does not independently inspect root-apply effects.

`settledCanonicalDispositions` filters entries against the requested project, policy, and source bytes. Covered decisions also require every quoted passage to remain in current readable canonical bytes; unrelated document edits need not invalidate coverage. `integratedCanonicalDrafts` exports the draft-key-to-preimage map without project or policy filtering. Callers therefore depend on the supplied event store's scope and evidence.

The ledger is cached per event-store object in a WeakMap and advances its sequence cursor during traversal. Loaded entries are not revalidated against retained CAS input on every call, and the cached cursor does not revisit skipped input.

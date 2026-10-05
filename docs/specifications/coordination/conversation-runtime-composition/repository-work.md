# Repository-work retrieval, measurement, and completion

## Retrieval and measurement

`conversation-repository-work-measurement.ts` prepares product-default search candidates. Only `knowledge_recovery_required` switches to operational search. Search failure produces an empty receipt with a bounded retrieval failure code; it does not by itself prevent execution. Opening project storage and reading selected candidate files are outside that recovery catch and may fail preparation.

The receipt holds the supplied source revision and at most three distinct document IDs. Each selected file is read with a 131,072-byte bound; its actual bytes are then hashed and counted. This function does not compare those bytes against a recommendation hash. Its evidence covers selection and loading, not injection, provider reference, or use.

Instructions contain paths and hashes, not document bodies. Empty receipts produce no context pointers. Measurement maps observed provider usage to provider-reported accounting and preserves unavailable usage as unavailable, including `provider_usage_unreported` when no usage is supplied.

Through the shared measurement contract, measurement records conversation attribution, the source event, worker, provider route, and context receipt. Paths are omitted from context documents passed to the recorder. This function does not pass the receipt's retrieval failure code to the measurement recorder.

## Completion ordering

`ConversationRepositoryWorkResponder` validates request text and selects the worker and provider route before admitting the source event in its local store. An in-progress duplicate attempts exact canonical-completion recovery. A completed turn reads and verifies the stored result and returns it without another provider execution or measurement pass.

For a new execution, configured replica readiness precedes observation. The responder captures the baseline and prepares context before invoking the provider. After execution, it observes changed paths, enforces provider-claim evidence, formats the reply, and stores its bytes. Changed work with configured replica readiness waits again and then reobserves the repository.

Measurement recording precedes checkpoint reconciliation and canonical completion verification. Context-preparation or measurement-recording exceptions become `measurement_unavailable`. Canonical verification precedes the local completed projection. A caught failure marks the local turn failed and propagates; this does not prove that repository or external effects did not occur.

## Knowledge mode

An explicit knowledge-mode option wins. Otherwise, writer schema version 3 or later selects background knowledge; an older or unreadable writer coordinate retains synchronous checks. Background instructions omit synchronous knowledge assignments. Background changed work prepares a source manifest for completion verification. These steps do not claim that background convergence has finished.

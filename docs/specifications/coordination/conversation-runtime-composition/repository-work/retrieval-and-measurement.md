# Retrieval and measurement

`conversation-repository-work-measurement.ts` prepares product-default search candidates. Only `knowledge_recovery_required` switches to operational search. Search failure produces an empty receipt with a bounded retrieval failure code; it does not itself prevent execution. Opening project storage and reading selected candidate files fall outside that recovery catch and may fail preparation.

The receipt holds the supplied source revision and at most three distinct document IDs. Each selected file is read with a 131,072-byte bound; its actual bytes are hashed and counted. The function does not compare those bytes against a recommendation hash. Its evidence covers selection and loading, not injection, provider reference, or use.

Instructions contain paths and hashes, not document bodies. Empty receipts produce no context pointers. Measurement maps observed provider usage to provider-reported accounting and preserves unavailable usage as unavailable, including `provider_usage_unreported` when no usage is supplied.

Through the shared measurement contract, measurement records conversation attribution, source event, worker, provider route, and context receipt. Context documents passed to the recorder omit paths. The function does not pass the receipt's retrieval failure code to the measurement recorder.

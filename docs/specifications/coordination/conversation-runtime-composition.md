# Conversation runtime scheduling and evidence composition

This specification records behavior visible in the assessed Node runtime sources. It does not establish installed acceptance, provider compatibility, or completion of the neutral adapter migration in ADR-0455.

## Change-loop scheduling

`ConversationChangeLoop` runs serial cycles. Starting an already running loop is unchanged. Start attempts a change subscription and schedules an immediate cycle; subscription failure falls back to timed operation. Stop cancels the timer, unsubscribes, and returns the active cycle's promise without aborting that cycle.

Notifications reset the idle streak and request immediate work. During a cycle they set a pending flag; the loop schedules another cycle afterward. The ordinary interval must be an integer from 100 to 60,000 milliseconds.

A cycle failure invokes `onFailure`. Unless `continueOnFailure` is enabled, it stops the loop and removes the subscription. With continuation enabled, an optional failure delay is accepted only when it is an integer from 100 to 300,000 milliseconds; otherwise the ordinary interval applies.

After a successful subscribed cycle, no next deadline means no timer. A future deadline schedules its remaining delay. A lapsed deadline uses the ordinary interval unless optional idle backoff classifies the result as unchanged. Consecutive unchanged lapsed-deadline results double the delay from `baseMs` to `ceilingMs`; the base is at least 100 milliseconds and the ceiling is at most one hour. A notification, changed result, future deadline, or absent deadline resets the streak. Deadline lookup failure falls back to the ordinary interval.

## Managed read composition

`openManagedConversationReadResponder` shares snapshot capture and a revisioned knowledge query when repository resources are supplied. Otherwise it creates those resources locally. It captures an initial snapshot and prepares knowledge before constructing the responder and combined turn resolver. Each plan captures a fresh snapshot, prepares repository context, and optionally adds the agent materializer's context as a required document.

A request-context execution profile may select its preferred provider for a read response. Model, effort, and timeout each use that provider's profile value when present, otherwise the corresponding `routing.response` value. Timeout finally defaults to 60 seconds. This function does not independently validate cross-provider fallback compatibility. Both adapter construction and execution identity use the resolved route. Profile configuration participates in the response policy digest.

The optional writing evaluator uses its separate configured provider route. Without it, replies use the realtime writing contract; with it, they use the adaptive contract. Both the responder and combined resolver receive the deliberation-verification callback. The local response and structured-output limit remains 2,000 characters.

## Repository-work retrieval and measurement

`conversation-repository-work-measurement.ts` prepares product-default search candidates. Only `knowledge_recovery_required` switches to operational search. Search failure produces an empty receipt with a bounded retrieval failure code; it does not by itself prevent execution. Opening project storage and reading selected candidate files are outside that recovery catch and may fail preparation.

The receipt holds the supplied source revision and at most three distinct document IDs. Each selected file is read with a 131,072-byte bound, then its actual bytes are hashed and counted. This function does not compare those bytes against a recommendation hash. Its evidence is selection and loading, not injection, provider reference, or use.

Instructions contain paths and hashes, not document bodies. Empty receipts produce no context pointers. Measurement maps observed provider usage to provider-reported accounting and preserves unavailable usage as unavailable, including `provider_usage_unreported` when no usage is supplied. It records conversation attribution, the source event, worker, provider route, and context receipt through the shared measurement contract. Paths are omitted from the context documents passed to that recorder. The receipt's retrieval failure code is not passed by this function to the measurement recorder.

## Repository-work completion ordering

`ConversationRepositoryWorkResponder` validates request text and selects the worker and provider route before admitting the source event in its local store. An in-progress duplicate attempts exact canonical-completion recovery. A completed turn reads and verifies the stored result and returns it without another provider execution or measurement pass.

For a new execution, configured replica readiness precedes observation. The responder captures the baseline and prepares context before invoking the provider. After execution it observes changed paths, enforces provider-claim evidence, formats the reply, and stores its bytes. Changed work with configured replica readiness waits again and then reobserves the repository.

Measurement recording precedes checkpoint reconciliation and canonical completion verification. Context-preparation or measurement-recording exceptions become `measurement_unavailable`. Canonical verification precedes the local completed projection. A caught failure marks the local turn failed and propagates; this does not prove that repository or external effects did not occur.

An explicit knowledge-mode option wins. Otherwise writer schema version 3 or later selects background knowledge; an older or unreadable writer coordinate retains synchronous checks. Background instructions omit synchronous knowledge assignments. Background changed work prepares a source manifest for completion verification. These steps do not claim that background convergence has finished.

## Provider instructions and reply formatting

Instructions include the last four prior turns, each bounded to 2,048 characters, and up to eight durable results, each bounded to 1,024 characters and presented in reverse order. Canonicalization assignments, normalization assignments, and optional context pointers are composed separately.

The instructions require an early checkpoint and reserve finalization time. They distinguish provider-observable checks from host-owned replica and completion gates, prohibit claiming pending background knowledge as current, and restrict external effects to explicitly requested effects admitted by requester authority. They also require deployment inspection to account for both singular and plural conversation configuration forms and require counts or absence claims to state their scope.

The requested final answer is below 1,500 characters in the conversation language. The current `fitDiscord` implementation trims text, replaces em dashes with hyphens, and caps output using Unicode code points at a 1,950-character limit. Oversize output is sliced with a 42-character reserve and receives a fixed Korean truncation notice. This remains a Discord-specific implementation; these sources do not prove descriptor-based limits or language-adaptive truncation have been implemented.

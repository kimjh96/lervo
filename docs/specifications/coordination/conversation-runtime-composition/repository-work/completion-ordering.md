# Completion ordering

`ConversationRepositoryWorkResponder` validates request text and selects the worker and provider route before admitting the source event in its local store. An in-progress duplicate attempts exact canonical-completion recovery. A completed turn reads and verifies the stored result and returns it without another provider execution or measurement pass.

For a new execution, configured replica readiness precedes observation. The responder captures the baseline and prepares context before invoking the provider. After execution, it observes changed paths, enforces provider-claim evidence, formats the reply, and stores its bytes. Changed work with configured replica readiness waits again, then reobserves the repository.

Measurement recording precedes checkpoint reconciliation and canonical completion verification. Context-preparation or measurement-recording exceptions become `measurement_unavailable`. Canonical verification precedes the local completed projection. A caught failure marks the local turn failed and propagates; this does not prove that repository or external effects did not occur.

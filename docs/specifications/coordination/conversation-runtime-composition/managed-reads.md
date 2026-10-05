# Managed read composition

`openManagedConversationReadResponder` shares snapshot capture and a revisioned knowledge query when repository resources are supplied; otherwise it creates them locally. It captures an initial snapshot and prepares knowledge before constructing the responder and combined turn resolver. Each plan captures a fresh snapshot, prepares repository context, and optionally adds the agent materializer's context as a required document.

A request-context execution profile may select its preferred provider for a read response. Model, effort, and timeout each use that provider's profile value when present, otherwise the corresponding `routing.response` value. Timeout finally defaults to 60 seconds. This function does not independently validate cross-provider fallback compatibility. Adapter construction and execution identity both use the resolved route. Profile configuration participates in the response policy digest.

The optional writing evaluator uses its separately configured provider route. Replies use the realtime writing contract without it and the adaptive contract with it. Both the responder and combined resolver receive the deliberation-verification callback. The local response and structured-output limit remains 2,000 characters.

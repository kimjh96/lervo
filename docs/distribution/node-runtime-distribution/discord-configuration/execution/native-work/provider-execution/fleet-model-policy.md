# Installed PO fleet model policy

The reviewed model policy is versioned separately from agent identity and repository authority; see the [policy reference](../provider-execution.md).

`reconcile-po-model-configs.mjs` dry-runs each exact Node configuration, then applies the same policy only with an explicit owner-only backup directory.

The policy selects:

- GPT-6 Sol at medium effort for routine work.
- Sol at high effort for reasoning.
- Opus 5.5 at high effort for native-work review.
- The reviewed three-Opus/five-Sol allocation at medium effort for the eight named CEO/PO conversation routes.
- The opposite provider at high effort for each named route's result evaluation.

Hired-agent conversation routes are not reassigned. The policy preserves each installed response timeout. A successful CLI version or account probe is not a latency canary.

The asynchronous, read-only Luna preparation path is not implemented by `routing.intent` and must not be claimed as active from this policy.

Check installed provider availability, exact requested routes, provider-observed models, and usage before claiming live execution.

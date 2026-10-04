# Product deliberation

`product_deliberation.inspect` (v11), exposed by `application deliberation --deliberation <id> --integration <id> --json`, adds `ProductDeliberationViewV1` for one installed conversation deliberation.

## Evidence projection

The read-only reader opens the start and resume queues without creating or migrating them and freezes one verified repository event head and repository revision. It joins:

- The exact origin.
- Embedded policy or an exact hash-matching legacy policy.
- Structured artifacts.
- Verification result bytes and suites.
- Terminal outcome.
- Organization participant bindings.
- Work-resource coordinate.
- Writing permit.
- Adapter delivery receipt.

It reads queue and delivery sources twice and rejects a change during projection.

## Policy and participant bindings

New `deliberation.started` events optionally embed the complete provider-neutral policy. The policy contains no topic, prompt, reasoning, provider response, credential, or native platform identifier.

Hash-only predecessor events remain valid. v11 uses the current policy source only when it recreates the recorded policy hash exactly; otherwise, exact projection is unavailable rather than reinterpreting the historical decision.

The route reports policy-only execution roles honestly. It accepts a hired-agent binding only when its deliberation, policy hash, role, semantic role version, provider selection, and provider-policy hash agree.

## Publication, delivery, and failures

A terminal notification's `accepted` state supplies no delivery claim. Publication is present only after one exact writing-gated outbound exists. Origin delivery is present only after that outbound carries a durable adapter receipt for the immutable conversation and thread.

Multiple outbounds, contradictory coordinates, queue/event artifact-count disagreement, and source changes fail closed.

The route grants no start, resume, approval, provider, publication, delivery, or canonicalization authority.

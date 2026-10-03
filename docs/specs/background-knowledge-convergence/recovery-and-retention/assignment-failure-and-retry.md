# Assignment failure and retry

## Failure receipt and authority

A stopped stage failure stores a private CAS receipt binding the exact assignment contract, input, lease ID and generation, normalized code, upstream evidence hash, and return time. Returning that exact lease records a failed assignment; it never accepts provider output or grants another write. Revocation permits failure bookkeeping but denies new document effects. Lost or expired authority cannot be silently replaced.

## Retry requirements

Retry requires the exact canonical failed completion and private artifact, current source and delegation, and a resolved stopped dependency. It reopens the same assignment with predecessor contract and responsibility hashes, terminal event ID, and an increasing lease generation. The hard limit remains sixteen attempts.

Provider reservations survive retries. Semantic stages allow at most three calls per stage batch within the delegation ceiling. Normalization generation and review share an eight-call limit. An unknown native reset still requires an exact successful availability probe.

Canonical assessment may retry one structurally invalid provider response within its existing stage batch. Both calls retain separate private observations. Neither an invalid response nor an exhausted reservation becomes source coverage.

A document normalizer process reporting typed status `timed_out` retries as a transient stage failure under the existing backoff and attempt ceiling. Its provider reservation stays in the same batch. Other `knowledge_compile_failed` outcomes still require attention.

Normalization generation allows each provider process up to ten minutes within the existing 25-minute batch elapsed ceiling. This window addresses observed five-minute timeouts on a busy WSL host without increasing the reviewed provider-call budget or assignment lease.

## Responsibility and path limits

Generator and reviewer identities retain the existing parent's read responsibility. New source roots may enter later baselines without widening parent authority or writer paths. Writer and integrator assignments remain limited to approved target paths. A legacy narrow reader may be replaced once by a stable identity bound to the existing parent responsibility, without new write authority.

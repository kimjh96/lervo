# Permission-failure evidence and recovery

An OS permission denial (`EACCES` or `EPERM`) on the configured provider executable, a mapped verification tool, or the native login probe is an observed failure. The affected provider, tool, or required CLI check becomes `failed`, with an evidence hash binding prior application evidence, configured executable identities, and the normalized probe result. A missing executable, timeout, or unrecognized response leaves the check `unobserved`.

If worker preflight of a recorded decision reports any `readiness_<kind>_failed` code, the runtime records `work.supervision.readiness.failed` for that decision before blocking. The decision remains `recorded`; no effect, lease, or provider process is claimed.

Repeating the same failed checks appends nothing. The record changes neither the task source revision digest nor the pending decision and never supersedes the unstarted dispatch.

The next cycle reinspects the same decision. After the host repairs permissions, fresh readiness passes and the original admitted decision executes without a new proposal. Reassignment remains behind the existing unstarted-responsibility revision until the exact lease expires; a live lease is never edited.

Neither the failure event nor a later ready observation proves resumed execution. Only the decision's confirmed effect does.

# Permission-failure evidence and recovery

An operating-system permission denial (`EACCES` or `EPERM`) on the configured provider executable, a mapped verification tool, or the native login probe is an observed failure, not an unobserved probe. The affected provider, tool, or required CLI check becomes `failed` with an evidence hash binding the prior application evidence, configured executable identities, and normalized probe result. A missing executable, timeout, or unrecognized response leaves the check `unobserved`.

When worker preflight of a recorded decision reports at least one `readiness_<kind>_failed` code, the runtime records `work.supervision.readiness.failed` for that decision before blocking. The decision keeps `recorded` status; no effect, lease, or provider process is claimed.

Repeating the same failed checks appends nothing. The record changes neither the task source revision digest nor the pending decision, so it never supersedes the unstarted dispatch.

The next cycle reinspects the same decision. After the host repairs the permission, fresh readiness passes and the original admitted decision executes without a new proposal. Reassignment stays behind the existing unstarted-responsibility revision after the exact lease expires; a live lease is never edited.

Neither the event nor a later ready observation proves resumed execution; only the decision's confirmed effect does.

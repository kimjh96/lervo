# Conversation mode and execution

`apps/node-runtime/src/conversation-repository-work-responder.ts` prioritizes an explicit knowledge-mode option. Otherwise, a readable selected event-writer version of at least 3 selects `pending_background`; older or unreadable coordinates select synchronous mode. The default pending baseline reads only the current workstream and sets `knowledgeCurrent` to false. A supplied completion-lifecycle implementation replaces the default composition.

Requests must be nonempty, contain no NUL, and fit within 16,384 characters. Configured-agent selection is the default; active delegate lookup occurs only for `conversation_delegate`. Route selection receives replay and session providers, delegate binding, execution profile, and configured provider/model routes.

Admission precedes execution. An in-progress duplicate attempts canonical completion recovery; absent recovery throws `repository_work_in_progress`. A completed result is read from CAS, checked against its byte count and hash, decoded as strict UTF-8, and republished without reexecution.

For new execution, configured replica readiness precedes repository observation and baseline capture. Only synchronous mode loads knowledge assignments into execution instructions. Pending mode therefore does not inject later-turn canonicalization or normalization assignments through this call site.

After execution, the responder:

1. Observes and compares repository state, then fits and stores the result.
2. For observed changes with a configured replica, waits for readiness and repeats observation and comparison.
3. Reconciles the checkpoint, prepares a source manifest for changed pending-mode work, verifies canonical completion, updates the local completed projection, and constructs the reply.

Errors within this execution block mark the local turn failed and are rethrown. Earlier admission and recovery operations are outside that catch.

The instructed finalization reserve is one fifth of the configured timeout, bounded between two seconds and five minutes. Its start cannot precede the calculation time. This instruction deadline does not establish provider compliance.

# Managed runs

`apps/cli/src/managed-run-repository-change.ts` returns null when the writable event schema version, which defaults to 1, is below 3. It builds before and after file maps from managed-change evidence, omitting null hashes, and passes optional before-commit coordinates to the repository planner. The source kind is `managed_run`; the source event is the supplied terminal completion event.

A null planner result produces no manifest write or append. Otherwise, the adapter stores the planned manifest and requires the returned content hash to equal the planned source-manifest hash before entering an event-store transaction. Within that transaction, it delegates to `appendRepositoryChange` with system actor and the supplied run, session, policy, event, and time coordinates.

Detached worker launch occurs only when:

- The append result reports `enqueued`.
- An explicit Codex or Claude provider is supplied.
- `LERVO_CLI_ENTRY` is defined.

The launch requests `knowledge worker --once --provider <provider>` for the repository root. These prerequisites do not prove a worker started, finished, or made knowledge current.

The adapter contract describes supervised recording after integration, but this function does not inspect integration evidence. Correct invocation ordering remains the caller's responsibility.

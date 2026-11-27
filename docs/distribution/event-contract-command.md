# Event-contract CLI command

`apps/cli/src/event-contract-command.ts` exposes writer-coordinate inspection, reader evidence collection, activation planning/application, rollback, and recovery. [ADR-0331](../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md) defines the reader-first writer contract; [ADR-0332](../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md) defines distributed reader authority.

The command implementation was not supplied for this assessment. The command surface and parsing descriptions below are retained documentation, not newly verified executable behavior. The automatic maintenance target is specified separately by the current outcome-and-event rollout contract.

## Command surface

```text
lervo event-contract --help
lervo event-contract -h
lervo event-contract status [--root <path>] [--json]
lervo event-contract evidence [--root <path>] [--json]
lervo event-contract activate (--from <path> | --stdin) [--schema-version <2-16>] [--apply <plan-id>] [--root <path>] [--json]
lervo event-contract rollback [--apply <plan-id>] [--root <path>] [--json]
lervo event-contract recover [--root <path>] [--json]
```

Argument parsing is strict. After successful parsing, `--help` or `-h` prints the five action usage lines above to stdout, followed by a newline, and returns 0. Help runs before positional-count, action-validity, schema-version-applicability, and action-specific-option checks, so it requires no action. Parser errors can still fail before help is handled.

Without help, exactly one positional action is required. `--schema-version` accepts 2 through 16, every version this release reads except 1, applies only to activation, and defaults to 2. `--root` resolves relative to the CLI working directory and defaults to `.`.

Version 5 enables the evidence-recovery and independently reviewed freshness-assessment receipt events. Version 6 adds the `context.quality.prepared` and `context.quality.verified` recording events. Versions 7 through 16 add native skill observation, practice learning, the plan ledger, the ADE's hosted session events, hosted turn usage, turns that end without a Stop hook, how a terminal hook's answer was delivered, prompts answered from the cached base, agents mentioning each other in a conversation, and claims in a conversation; [event envelope compatibility](../specifications/execution/events-and-privacy/event-envelope-compatibility.md) lists each. Install every configured reader through the target schema before activation. Default writer selection remains version 1. `lervo upgrade --apply` activates version 16 once every configured reader reads it ([ADR-0650](../decisions/distribution/0650-raise-the-event-writer-target-to-schema-16-after-its-readers.md)). The [outcome-and-event rollout contract](../specifications/execution/context-quality/outcome-and-event-rollout.md) specifies explicit version-6 activation through fresh reader-inventory evidence and the exact apply-plan contract.

## Inspection and evidence

`status` delegates to project coordinate inspection. Human output reports the selected event schema version, source, and `.lervo/data/event-contract.json`; `--json` returns the inspection object. `evidence` collects reader activation evidence and always prints JSON. Both reject activation input and apply options.

Activation requires exactly one of `--from` and `--stdin`. File paths resolve from the CLI working directory; stdin must be available. The command rejects UTF-8 content above 64 KiB, invalid JSON, and evidence rejected by the project evidence reader.

For a Hub-sync-enabled project or an activation target of 3 or higher, the command collects current authoritative evidence and compares it with supplied evidence using `eventWriterActivationObservationHash`. A mismatch fails with `event_writer_plan_stale` before planning. For sync-disabled activation targeting 2, the command does not collect this additional observation.

## Planning, application, and recovery

Activation without `--apply` prints a public JSON plan and returns 1 if its status is blocked, otherwise 0. Public plans omit `desiredContent` and `activationEvidence`. With `--apply`, the command passes the plan, supplied approval ID, and any current evidence to `applyEventWriterActivationPlan`, then prints its receipt.

Rollback rejects activation evidence options. Without `--apply`, it prints the redacted rollback plan; with `--apply`, it delegates application and prints the receipt. Recovery rejects activation input and apply options, delegates to `recoverEventWriterActivation`, and prints the result.

The command delegates coordinate mutation, approval validation, transaction durability, and recovery guarantees to `@lervo/project`. These calls alone do not prove that activation, rollback, or recovery succeeded in an installed repository.

Caught failures print a string error code when present, the error message, and action usage to stderr, then return 1. Plans, receipts, evidence, and recovery results are JSON regardless of `--json`; the option changes only status presentation.

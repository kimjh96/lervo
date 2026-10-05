# Service diagnostics and recovery evidence

The shared `openNodeSupervisionService` composition accepts an optional synchronous `log(line)` callback; otherwise, diagnostics go to the process error stream. Recovery-evidence read failures and uncertain-effect failures use the same logger as non-dormant cycle failures. Lineage-follow errors also use the cycle-failure formatter. Diagnostics are separate from health fields and canonical attention codes: their occurrence or successful formatting does not prove recovery, effect completion, or delivery. The [local supervision command](../local-command.md) shares this composition.

## Recovery-evidence read failures

Within `openNodeOutcomeSupervisionRuntime.readSnapshot`, the recovery-authority try block reads recovery authority, checks workstream revision and causal coordinates, and constructs the combined source binding. A coordinate mismatch returns conflicting evidence. An exception in this block invokes optional `reportEvidenceReadFailure(error)`, then returns the existing snapshot with `authorityStatus: unobserved` and `evidenceStatus: unavailable`. Earlier snapshot and mandate reads are outside this catch.

The callback runs synchronously without a protective catch. If it throws, the unavailable-snapshot return is not reached. It is not an isolated or guaranteed non-failing telemetry boundary.

## Diagnostic formatting

Formatting retains the outer error message and follows at most three non-null causes. Error causes contribute their names and messages; other values are converted to strings. The combined message uses ` <- ` separators, replaces runs of carriage returns, newlines, and NUL characters with spaces, and is sliced to 200 characters for cycle and recovery-evidence diagnostics or 400 for uncertain effects.

These are JavaScript string-length limits on the combined message, not byte or whole-line limits. The outer error name, fixed prefix, code suffix, effect coordinates, and optional bundle coordinate are outside the slice.

A top-level code is accepted only if it matches `^[a-z][a-z0-9_]{0,63}$`. Otherwise, cycle and evidence diagnostic prefixes derive a code from the Error name by removing a trailing `Error`, separating lower-case-or-digit to upper-case transitions, and lowercasing. Invalid or empty results use `cycle_error_unclassified`. A valid original code is also appended in square brackets to the formatted detail. Uncertain-effect prefixes name the plan's action kind and effect contract.

Cycle diagnostics may append `origin=bin.js:<line>:<column>` extracted from the first stack frame. Extraction omits the frame's host path but does not redact paths elsewhere in an error. Evidence-read and effect formatters do not append this stack coordinate.

## Privacy boundary

The formatter performs no general redaction of messages or causes. Paths, credentials, prompts, task prose, provider errors, and configuration content can remain when present in upstream errors. Error names are also outside message truncation and normalization. The health privacy guarantee does not extend to arbitrary diagnostic text. Diagnostic output must not be described as codes-only or as automatically excluding these contents.

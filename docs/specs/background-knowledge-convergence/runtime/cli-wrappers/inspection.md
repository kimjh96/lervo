# Inspection

`lervo knowledge convergence status [--json]` and `inspect [--json]` share a read-only storage inspection path. Other trailing arguments are rejected. Both emit JSON; `--json` enables indentation. After storage opens, a finally block attempts to close it.

Inspection reports an error code only if it is a string matching `^[a-z][a-z0-9_]{0,127}$`; otherwise it reports `knowledge_inspection_failed`. This validation is specific to the inspection wrapper.

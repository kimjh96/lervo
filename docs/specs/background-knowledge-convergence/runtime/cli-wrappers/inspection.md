# Inspection

`lervo knowledge convergence status [--json]` and `inspect [--json]` share a read-only storage inspection path. Both reject other trailing arguments and emit JSON; `--json` enables indentation. After storage opens, a finally block attempts to close it.

The inspection wrapper reports an error code only if it is a string matching `^[a-z][a-z0-9_]{0,127}$`; otherwise it reports `knowledge_inspection_failed`. This validation is specific to the inspection wrapper.

The status object's `owner` is the latest [cross-host ownership](../ownership-and-activation/cross-host-ownership.md) verdict from the private fence, or `null` if this host never observed ownership.

- [Owner commands](inspection/owner-commands.md): inspect ownership, release a lease, or publish.
- [Continuity doctor](inspection/continuity-doctor.md): inspect fleet continuity and report findings. See [fleet continuity findings](../ownership-and-activation/continuity.md#findings).

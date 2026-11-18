# Routine assignment provenance

Routine-created `assignment.created` events additionally retain nullable required-capability hash, routine ID, template version and hash, invocation ID, `manual` trigger kind and digest, node key, and approval digest. They exclude the template, trigger request, idempotency key, criteria, approval text, and paths.

These fields prove deterministic assignment provenance, not trigger delivery, scheduling, claim, provider startup, or execution. Historical absence means ordinary assignment creation.

A failed node records no creation event. Previously committed nodes remain an exact partial invocation for idempotent replan and resume.

[ADR-0560](../../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed routine materialization. No current command writes these fields, and stored events that carry them stay valid and readable.

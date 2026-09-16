# Commit ordering and hook failures

Preparation commits before context. Declaration commits after repository work. Reference and turn commit together before Stop.

Missing context during mid-turn hook activation emits no event or receipt and requests one bounded continuation.

Any valid re-entered Stop marked `stop_hook_active` returns empty success before repository or persistence work and creates no observation or receipt, even when preparation exists.

Malformed input, stale declaration, and persistence failure fail closed.

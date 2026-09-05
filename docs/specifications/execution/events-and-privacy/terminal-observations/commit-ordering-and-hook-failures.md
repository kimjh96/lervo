# Commit ordering and hook failures

Preparation commits before context; declaration commits after repository work; reference and turn commit together before Stop.

Missing context during mid-turn hook activation emits no event or receipt and requests one bounded continuation. Any valid re-entered Stop marked `stop_hook_active` returns empty success before repository or persistence work and creates no observation or receipt, even when preparation exists.

Malformed input, stale declaration, and persistence failure fail closed.

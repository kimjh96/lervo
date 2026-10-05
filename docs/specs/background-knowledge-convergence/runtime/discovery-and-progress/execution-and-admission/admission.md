# Admission

Shared host admission permits two background calls across providers and one per repository, with oldest eligible waiter fairness. Active ordinary work defers admission without preempting an existing call.

After an admission owner process exits, the next admission transaction immediately removes its slot, even before timeout. A live owner's active slot remains reserved until release or its existing recovery contract applies. A dead process cannot block the same repository's next bounded attempt for the full timeout.

Foreground admission defers capability-free provider work during an ordinary assignment's current unexpired lease. Missing or invalid expiry remains fail-closed; expired lease metadata alone cannot defer read-only generation forever.

This scheduling predicate neither proves a native process stopped nor settles, cancels, reopens, or removes the expired assignment. Existing effect and lease contracts still govern uncertain effects, scoped write conflicts, exact source checks, and integration recovery.

The worker and explicit provider probe share this predicate; caller-supplied current-work observations may remain stricter.

# Ownership, execution, and persistence

- [Ownership and execution](ownership-and-persistence/ownership-and-execution.md): cycle leases, fencing, effect admission, and supervision identity.
- [Persistence and failures](ownership-and-persistence/persistence-and-failures.md): reused durable contracts and failure behavior.

## Validation

Real SQLite/CAS tests cover restart confirmation without duplicate execution, old-source uncertainty, owner changes during admission and after idle, Hub authority rejection, close ordering, escaped sessions, and selected version 2/3 Node writers.

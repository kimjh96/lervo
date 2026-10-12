# ADR-0509: Install the SQLite busy handler before any other statement

Status: `accepted`
Decision date: 2026-10-13

## Context

During the 2026-10-13 runtime upgrade on the WSL host, the plen and flemo Nodes each exited once at startup with `startup_failed: Could not open the Node runtime configuration. Cause: database is locked`. systemd restarted each Node five seconds later, and both then started normally.

Lervo opened its SQLite stores in 40 places. Most ran `PRAGMA journal_mode = WAL` first and set `PRAGMA busy_timeout` only afterwards. Some set no wait at all: the conversation repository-work store and the read-only conversation-history and Discord request-provenance readers. Until the busy handler is installed, a statement that needs a lock fails at once.

A two-process reproduction on Node 26.5.1 and 22.13.0 held a WAL database exclusively for 400 ms:

| Statement order                             | Result                                       |
| ------------------------------------------- | -------------------------------------------- |
| `journal_mode` first, `busy_timeout` second | Failed within 1 ms with `database is locked` |
| `busy_timeout` first                        | Waited about 470 ms, then succeeded          |

Node's `DatabaseSync` `timeout` option sets the wait at construction. However, `@types/node` for the supported minimum, Node 22.13, does not declare it.

## Decision

`@lervo/sqlite-connection` owns opening SQLite connections. `openSqliteDatabase(path, options)` requires `busyTimeoutMs`. It runs `PRAGMA busy_timeout` as the connection's first statement and closes the connection if that fails. `SQLITE_BUSY_TIMEOUT_MS` (5,000) is the ordinary store wait.

Every production connection uses it. Callers that treat a held lock as an answer keep their wait:

| Caller                                                |   Wait |
| ----------------------------------------------------- | -----: |
| Supervision process lock                              |   0 ms |
| Node work admission                                   | 100 ms |
| Repository source gate                                | 100 ms |
| Resident health, when it does not create the database | 100 ms |

Later `busy_timeout` statements were removed, so each connection's wait is set in one place. An ESLint rule rejects `new DatabaseSync` in application and package sources outside this package. Tests, evaluation scripts and distribution pilots may still construct connections directly.

## Consequences

A startup that meets another process's lock now waits up to five seconds instead of exiting, and so do the three stores that had no wait. Behavior with no contention is unchanged. A lock held longer than the wait still fails as before.

# Host filesystem access readiness

## Scope and authority

Node supplements positive `read_scope` and `write_scope` application checks with read-only filesystem access observations in the registered Git worker workspace. Initial and final execution preflights inspect the deduplicated union of exact plan and canonical responsibility paths. Assignment, lease, ancestry, and workspace checks continue to bind this scope to reviewed authority.

The observer accepts one to 32 distinct relative paths, each at most 4096 characters and 32 components. Empty components, dot components, parent traversal, backslashes, NUL, colons, and wildcard syntax are unsupported. It expands no glob and walks no directory subtree. A named directory observation covers only that directory; the application must supply evidence for task-specific descendants and external tools.

Observations establish access for the Node process under its current operating-system credentials. They prove neither another worker identity's permissions nor provider sandbox, container, MCP, remote-service, or network permission. The effect adapter must select the same reviewed workspace and revalidate its actual operation under its own identity at commit. Inspection grants no permission and activates no production worker.

## Read-only inspection

The observer canonicalizes the registered workspace path and rejects a symlink workspace root. It checks search access through the root and each existing directory ancestor. Symlinks below the root, special files, hard-linked regular files, and nondirectory ancestors reject observation. Canonical ancestors above the registered root may include host aliases, such as a temporary-directory alias.

For existing targets, read observation requires read access and, for directories, search access. Write observation requires write access and directory search access where applicable, plus write/search access to the target parent for replacement. These conservative checks attempt no read, write, creation, replacement, or deletion.

For an absent target or ancestor, the probe requires read/search access to the nearest existing directory, plus write access for a write observation. This proves only observed ancestor access, not that a missing input exists, later creation will succeed, or descendants are accessible. Application evidence remains responsible for required input existence and operation-specific semantics.

The observer rereads every inspected entry's device, inode, mode, owner/group IDs, metadata-change time, and link count; rechecks recorded absence; and confirms the workspace still resolves to the same root. Node then repeats canonical workspace inspection and requires unchanged workspace evidence, assignment, and ancestry within its zero-to-five-second repository observation interval. Filesystem calls are asynchronous observations, not a transaction or hard I/O cancellation deadline. ACL changes, mounts, sandbox changes, and other races after inspection still require effect-boundary checks.

## Evidence and failure meaning

Successful checks combine the original application evidence hash with a digest of the mode, workspace coordinates, exact paths, and bounded filesystem observations. Readiness retains no file content, absolute path, account identity, raw error, or permission listing. No credential is read; no event or persistent filesystem-access projection is added. The original application observation time is preserved.

An unavailable, denied, unsafe, unsupported, or changing filesystem scope changes only an already passed corresponding scope check with evidence to `unobserved` with null evidence. Access observations never promote failed, unobserved, not-required, or missing-evidence checks. A surrounding repository authority or workspace failure also invalidates scope admission. Existing `readiness_read_scope_unobserved` and `readiness_write_scope_unobserved` reasons block admission. Failure after a durable decision follows the existing uncertain-result inspection contract without invoking the effect.

## Verification and remaining work

Disposable filesystem tests cover existing files, absent-target ancestors without creation, path bounds, traversal and wildcard rejection, symlinks, hard links, nondirectory ancestors, and distinct read/write permission failures. Disposable Git worker tests cover a symlink at the responsibility target and write permission lost between execution preflights. POSIX mode-denial tests are skipped for root and Windows because those fixtures cannot establish the intended denial.

Environment-based and remote authentication, provider and external-tool permissions, worker context delivery, source policy, actual verification execution, budget/process observations, and responsibility installation remain separate work. Directory-boundary access cannot certify every operation an installed worker might attempt.

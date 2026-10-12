# ADR-0504: Bind Node admission to observed process birth

Status: accepted
Date: 2026-10-11

## Context

After WSL restarted, the Digimon Node could not acquire its work scope. Its old admission row named PID 342, which now belonged to the unrelated Argo Python collector. The admission store tested only whether that PID existed. It retained the stale session and the service repeatedly failed to start. A bounded operational recovery backed up the database, verified that the scope had no work claims or upgrade freeze, removed the single stale session and restarted the unchanged Node.

Session ownership also protects the upgrade freeze defined by [ADR-0489](0489-migrate-node-configurations-only-inside-the-service-transition.md). Repairing session cleanup alone would leave the same PID-reuse defect in upgrade ownership. Process inspection must not hold a SQLite write lock while an external command runs.

## Decision

`node-work-admission` owns this repair. Keep OS observation, pure birth parsing/comparison, database setup and transactional admission in separate modules. Replace the injected Boolean liveness observation with a three-way process observation: `present` with a bounded birth-identity string, `absent`, or `unknown`. Only proven absence or a different birth within the same observation scheme permits stale-owner cleanup.

New sessions and freezes capture their owner's birth before entering the transaction. A missing or unknown birth refuses registration with `admission_invalid`. Existing live or unobservable owners remain protected. Work acquisition and frozen-configuration replacement require matching birth evidence as well as the existing token, PID, scope and configuration checks. Wrong or replaced freeze ownership cannot release the freeze or change its configuration binding.

Before each relevant transaction, observe at most two session rows and one freeze row. The OS calls run after the SQLite reads finish and before acquiring the write lock. Cleanup inside the transaction matches the exact kind, token, PID and stored identity that was observed. A replaced row has no inherited observation and remains protected. A same-process birth is cached only for the store lifetime; foreign process observations are never reused across operations.

## Platform evidence and limits

- Linux combines the kernel boot UUID, PID and `/proc/<pid>/stat` start ticks. Parsing locates the closing command-name delimiter before reading field 22. It does not split a process name on spaces or parentheses. The [Linux process-stat contract](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html) defines start ticks relative to boot.
- Darwin combines `kern.bootsessionuuid`, PID and the C-locale, UTC `ps -o lstart` value. The system tools use absolute paths. Apple stores the process birth timestamp in its [process record](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_proc.c), but this command exposes only seconds. Same-second PID reuse is ambiguous and retains ownership; it is not proof of a different process.
- Windows combines PID and the decimal UTC FILETIME returned by the system PowerShell process API. Preserve all digits rather than converting through a JavaScript number. The [.NET process-start contract](https://learn.microsoft.com/dotnet/api/system.diagnostics.process.starttime) supplies the creation time. Missing PowerShell, denied access or command failure yields unknown identity.

Commands accept only a validated integer PID, use no shell interpolation, ignore stdin, hide Windows console windows and bound output to 4 KiB and each invocation to five seconds. Unsupported platforms, malformed metadata and access failures are unknown. A failed metadata command is never treated as proof of exit; a separate `kill(pid, 0)` check must report `ESRCH` for absence. Equal timestamps retain ownership, including any collision at the platform's timestamp resolution. This is conservative recovery from observed replacement, not a kernel process-handle lock or a guarantee against every ambiguous PID reuse.

## State, compatibility and privacy

Add nullable `owner_identity` to `node_work_session` and `freeze_identity` to `node_work_scope` inside the existing schema transaction. Keep database user version 1 and all original columns so preceding runtimes can still read the store and insert rows with null identity. No table, event, sidecar file or per-process archive is added. Ending a session and releasing a freeze retain the existing cleanup lifecycle.

An identity contains a bounded versioned scheme name and SHA-256 digest. Current schemes are `proc_linux_ticks_v1`, `proc_darwin_seconds_v1` and `proc_windows_filetime_v1`. The digest binds the coordinates above. Raw boot IDs, start times, command lines and environment values are not persisted. Different scheme versions are incomparable and retain ownership; changing an algorithm cannot make a live owner appear stale.

A null legacy identity is never inferred from the process currently occupying its PID. Such a row is removed automatically only after proven PID absence. Existing live older Nodes therefore remain excluded correctly, and new upgrade freezes still block their work through the original columns. Earlier binaries retain their PID-only behavior; rolling back does not acquire the new recovery guarantee. Recovery of an ambiguous legacy owner requires independent process/configuration evidence, a backup and a narrowly guarded state repair, as in the WSL incident.

Malformed stored identities fail with `admission_invalid`. A missing or nonmatching work session fails with `admission_claim_lost`; unknown freeze ownership retains the freeze, and replacement/unfreeze returns false. No policy, service-stop, writer-activation or publication authority follows from these observations.

## Verification and completion

Verify session and freeze PID reuse, a genuinely live competing owner, active-claim preservation, legacy rows, preceding-writer compatibility, incomparable identity versions and unknown observations. Prove that a second SQLite writer can proceed during the OS observation and that a concurrently replaced row cannot inherit stale evidence. Exercise actual own/child birth and exit on Linux, Darwin and native Windows, including minimum Node 22.13.0.

Installed Node/Hub startup, synchronization, restart and outage recovery, service upgrade/rollback fences, generated release metadata and the normal release completion contract remain required. These tests do not close recording-performance, real-provider quality or fleet deployment gates. The [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) and [platform record](../../../evidence/quality/context-quality/context-quality-platform-qualification.md) retain those boundaries.

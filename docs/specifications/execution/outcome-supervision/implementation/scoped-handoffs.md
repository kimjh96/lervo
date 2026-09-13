# Scoped owner handoffs

The Node supports separate repository owners through `work.scoped_handoff.v1` and `work.scoped_handoff_acceptance.v1`. Each party binds its project, team, workstream and revision, owner agent, and installed mandate hash. The offer pins both workstream snapshots, a request artifact, the acceptance-criteria hash, a rationale artifact, and expiry. The request contains one objective, deliverables, acceptance criteria, and up to 32 evidence artifact hashes. Neither effect contains an assignment lease, executor transfer, or foreign write permission.

The original owner retains the overall goal. A successor accepts only the exact offered scope under its own existing active workstream and installed authority, after assessing whether the scope belongs to its goal. Acceptance does not complete either goal, import a foreign assignment, or prove user receipt of a result. A goal with pending current handoffs cannot complete.

- [Installed observations](scoped-handoffs/observations.md)
- [Admission and replay](scoped-handoffs/admission.md)
- [Local decision attention](scoped-handoffs/attention.md)
- [Verification boundary](scoped-handoffs/verification.md)

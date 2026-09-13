# Canonical task observations

`SupervisionTaskSource` reads the exact current workstream and its recorded event, actual agents and assignments, verified responsibility artifacts, managed attempts, resource observations, and the versioned work graph. It rejects changed source bytes or an advancing event head during observation.

It retains execution events through the existing bounded, hash-anchored incremental history reader, preserving the 100,000-event, 32 MiB, and 60-second audit limits. Warm reads avoid historical event scans; they do not imply cached active responsibility artifact reads.

The source exposes canonical facts and a task-source digest. It does not infer provider startup, zero resource usage, accepted artifacts, or delivered responses.

# Governed loops and execution graphs

```text
trigger -> load checkpoint -> managed attempt -> observe -> verify
        -> complete | retry | block | escalate
```

The workstream bounds the objective and continuation scope. An assignment is a work node; a managed run is one attempt; an agent is the executor; verification is the completion gate. Events plus CAS provide observable history and recovery.

Execution-graph v1 should extend the assignment DAG with versioned nodes, dependencies, bounded conditional transitions, parallel branches, joins, approval gates, handoffs, escalation, and cycle validation. Bounded local retries may occur within a node. Arbitrary graph cycles and agent-authored topology changes require later evidence.

Loops and graphs need not finish as infrastructure projects before product work. They provide shared implementation discipline for operating boards, routines, resumable work, collaboration routes, and verified improvement.

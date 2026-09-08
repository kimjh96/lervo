# Operating routes

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_objective.inspect` | `loop objective --json` | read-only |
| `governed_work.inspect` | `loop status --json` | read-only |
| `observed_budget.inspect` | `loop budget --json` | read-only |
| `operating_board.render` | `loop board` | read-only HTML |
| `governed_attempt.execute` | `loop run` | lease-bound managed execution |
| `governed_completion.reconcile` | `loop reconcile` | exact plan/apply |
| `assignment_routine.materialize` | `routine materialize` | exact plan/apply |
| `unattended_scheduler.execute` (v5) | `loop schedule` | bounded unattended execution |
| `assignment_graph.inspect_v2` (v6) | `assignment topology inspect --json` | read-only |
| `assignment_topology.change` (v6) | `assignment topology change` | reviewed topology change |

The v1 budget result preserves total-token fields and adds discriminated token-dimension and duration assessments. These read-only additions derive from the same governed-work policy. Hosts must treat `unknown` and `reached` as unsuccessful budget status.

## Protocol v2

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_attention.inspect` | `application attention --json` | read-only |
| `operating_goal.inspect` | `loop goal --json` | read-only |

## Protocol v3

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_liveness.inspect` | `application liveness --json` | read-only |

Liveness separates root-agent heartbeats from managed-provider process observations. Provider-process items are the latest point-in-time observations per opaque session digest, not current-health claims. `unobservable`, stale, revision-changed, and exited results grant no release or recovery authority.

## Protocol v5

The bounded foreground scheduler requires explicit `--write`, finite invocation limits, one provider, current governed checkpoints, exact claim and lease ownership, existing resource and attempt budgets, and a repository-local kill switch. Its result is a bounded process observation, not a task store or authority grant. See [bounded unattended assignment scheduling](../../unattended-scheduling.md).

## Protocol v6

Graph-v2 inspection and additive topology change bind planning to the exact current graph and role contracts. Apply requires the exact plan, approval hash, reviewer, and explicit write flag. The topology-change route can create only a bounded acyclic node set; it cannot edit or delete an existing assignment. See [bounded dynamic assignment topology](../../dynamic-assignment-topology.md).

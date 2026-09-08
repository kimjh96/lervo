# Product-host route inventory

Each route remains owned by its existing domain or adapter; the capability command does not centralize route policy.

## Workforce

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `workforce_agent.inspect` | `agent list --json` | read-only |
| `workforce_agent.hire` | `agent hire` | explicit write |
| `workforce_agent.status` | `agent status` | explicit write |
| `workforce_assignment.inspect` | `assignment list --json` | read-only |
| `workforce_assignment.create` | `assignment create` | explicit write |
| `workforce_assignment.claim` | `assignment claim` | explicit write |
| `workforce_assignment.renew` | `assignment renew` | explicit write |
| `workforce_assignment.cancel` | `assignment cancel` | exact plan/apply |
| `workforce_assignment.handoff` | `assignment handoff` | explicit write |
| `workforce_assignment.complete` | `assignment complete` | explicit write |

## Operating

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

Protocol v2 adds:

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_attention.inspect` | `application attention --json` | read-only |
| `operating_goal.inspect` | `loop goal --json` | read-only |

Protocol v3 adds:

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_liveness.inspect` | `application liveness --json` | read-only |

Liveness separates root-agent heartbeats from managed-provider process observations. Provider-process items are latest point-in-time observations per opaque session digest, not current-health claims. `unobservable`, stale, revision-changed, and exited results grant no release or recovery authority.

Protocol v5 adds a bounded foreground scheduler requiring explicit `--write`, finite invocation limits, one provider, current governed checkpoints, exact claim and lease ownership, existing resource and attempt budgets, and a repository-local kill switch. Its result is a bounded process observation, not a task store or authority grant. See [bounded unattended assignment scheduling](../unattended-scheduling.md).

Protocol v6 adds graph-v2 inspection and additive topology change. Planning binds the exact current graph and role contracts; apply requires the exact plan, approval hash, reviewer, and explicit write flag. The route can create only a bounded acyclic node set and cannot edit or delete an existing assignment. See [bounded dynamic assignment topology](../dynamic-assignment-topology.md).

## Organization

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `organization_team.bind` (v7) | `organization bind-team` | explicit write |
| `organization_portfolio.inspect` (v7) | `organization portfolio` | read-only |
| `agent_context.inspect` (v7) | `agent context inspect` | read-only |
| `agent_context.promote` (v7) | `agent context promote` | reviewed context promotion |
| `agent_context.handoff` (v7) | `agent context handoff` | explicit write |
| `organization_ceo.evaluate` (v7) | `organization ceo-evaluate` | bounded CEO policy |

Protocol v7 composes repository-owned team snapshots without creating central state authority. Context promotion requires an exact source, CAS summary, and qualifying review; handoff names exact source-owned entries. CEO evaluation verifies the content-addressed operating report, appointment, action and team allowlists, automation depth, observed budget policy, and approval, then returns a decision without performing the effect.

## Collaboration

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `assignment_thread.inspect` | `loop thread` | read-only |
| `assignment_inbox.inspect` | `loop inbox` | read-only |
| `assignment_mention.route` | `assignment mention` | exact plan/apply |
| `assignment_connector.route` | `assignment connector` | injected adapter for effect |
| `assignment_message_trigger.route` (v4) | `assignment trigger` | exact plan/apply |
| `assignment_handoff.acknowledge` (v4) | `assignment acknowledge` | explicit recipient write |

The v4 installed trigger adapter consumes only reviewed, content-addressed direct-message observations. Its exact plan/apply reuses current mention and handoff authority; it neither authenticates an external platform nor starts work. Acknowledgment validates an exact active recipient-agent coordinate, does not authenticate a human principal, and never upgrades delivery or action.

Protocol v4 adds `--contract 2` to existing `assignment_thread.inspect` and `assignment_inbox.inspect` descriptors, selecting communication contract v2. The report exposes recorded acknowledgment and reviewed-trigger provenance. Default CLI commands and protocol v1–v3 descriptors retain communication contract v1 with unchanged shape and unobserved acknowledgment semantics.

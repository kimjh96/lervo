# Product-host protocol

Status: `active`
As of: 2026-09-05

## Purpose and discovery

Separately installed operating or collaboration products discover and compose Lervo locally through the installed `@lervo/cli` process, without a Hub, workspace-private imports, or storage-internal access.

Default discovery returns the 21-route `ProductHostCapabilityReportV1`:

```bash
lervo application capabilities --json
```

Explicit version requests add capabilities without changing earlier versions' discovery:

- v2 adds read-only operating-attention and operating-goal routes and projections.
- v3 adds the read-only operating-liveness route and projection.
- v4 adds reviewed direct-message triggering, explicit handoff acknowledgment, and its acknowledgment projection.

```bash
lervo application capabilities --protocol 2 --json
lervo application capabilities --protocol 3 --json
lervo application capabilities --protocol 4 --json
```

All versions are compatibility and discovery contracts, not authority grants, repository snapshots, or assertions that route prerequisites are satisfied.

## Report contract

Each report contains:

- Protocol-matching `schemaVersion` and `kind: product_host.capabilities`.
- Protocol transport, version, discovery command, and `requiresHub: false`.
- Canonical authority classes that products must not duplicate.
- Rebuildable projection classes that products may render or transform.
- Ordered route descriptors with area, operation, stable result-contract identifier, command prefix, output, effect, authority, and availability.
- Explicit unsupported product capabilities.

Command arrays omit the executable name and repository-specific arguments. Products invoke the installed `lervo` executable, add required route arguments, and request the declared output. Help text is human guidance, not the machine discovery contract.

## Route inventory

### Workforce

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

### Operating

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_objective.inspect` | `loop objective --json` | read-only |
| `governed_work.inspect` | `loop status --json` | read-only |
| `observed_budget.inspect` | `loop budget --json` | read-only |
| `operating_board.render` | `loop board` | read-only HTML |
| `governed_attempt.execute` | `loop run` | lease-bound managed execution |
| `governed_completion.reconcile` | `loop reconcile` | exact plan/apply |
| `assignment_routine.materialize` | `routine materialize` | exact plan/apply |

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

Liveness reports keep root-agent heartbeat and managed-provider process observations in separate collections. Provider-process items are latest point-in-time observations per opaque session digest, not current-health claims. `unobservable`, stale, revision-changed, and exited results grant no release or recovery authority.

### Collaboration

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `assignment_thread.inspect` | `loop thread` | read-only |
| `assignment_inbox.inspect` | `loop inbox` | read-only |
| `assignment_mention.route` | `assignment mention` | exact plan/apply |
| `assignment_connector.route` | `assignment connector` | injected adapter for effect |
| `assignment_message_trigger.route` (v4) | `assignment trigger` | exact plan/apply |
| `assignment_handoff.acknowledge` (v4) | `assignment acknowledge` | explicit recipient write |

The v4 installed trigger adapter consumes only reviewed, content-addressed direct-message observations. Its exact plan/apply reuses current mention and handoff authority; it does not authenticate an external platform or start work. Acknowledgment validates an exact active recipient-agent coordinate, does not authenticate a human principal, and never upgrades delivery or action.

Protocol v4 also adds `--contract 2` to its existing `assignment_thread.inspect` and `assignment_inbox.inspect` descriptors, selecting communication contract v2. That report exposes recorded acknowledgment and reviewed-trigger provenance. Default CLI commands and protocol v1–v3 descriptors retain communication contract v1 with unchanged shape and unobserved acknowledgment semantics.

Each route remains owned by its existing domain or adapter; the capability command does not centralize route policy.

## Authority and state

Repository state, workstreams, assignments, leases, events, verification, and artifacts remain canonical. Assignment graphs, operating goals, governed decisions, operating boards, threads, inboxes, observed budgets, operating liveness, and acknowledgment views are rebuildable projections. Products may cache presentation state but must not turn it into assignment, approval, completion, delivery, acknowledgment, liveness, or verification authority.

An `available` route can still reject missing roles, workstreams, assignments, leases, approvals, verification, resources, or repository state. Products must preserve its exit status and typed result rather than convert an unavailable or invalid result into an empty success.

External connector effects remain unavailable in the stock CLI. Hosts injecting a connector must meet the separate descriptor, credential, destination, artifact, writing-permit, durable-reservation, unknown-effect, and common-conformance contracts.

## Unsupported capabilities

Versions 1–4 provide no product UI, product-owned task or chat database, unattended scheduler, dynamic graph mutation, implicit approval, or managed semantics for direct provider terminals. Consumers must not infer authority from a successful query or render.

Protocol v2 attention and goal reports add no inbox, goal store, acknowledgment, resolution, or scheduling authority. Protocol v3 liveness adds no process controller, polling, recovery, reassignment, or lease-release authority.

Protocol v4's reviewed-input adapter is not a live Slack, Discord, webhook, or Hub receiver. Its acknowledgment route is not delivery, approval, assignment acceptance, provider execution, or completion evidence.

## External-consumer acceptance

`pnpm smoke:packed-cli` builds the real tarball, installs it into an empty temporary consumer, and runs the protocol without workspace imports. The fixture verifies:

- Default 21-route v1, explicit 23-route v2, explicit 24-route v3, and explicit 26-route v4 reports.
- The exact connector limitation and unsupported capabilities.
- Absence of workspace coordinates and private Lervo package installation.

Using only CLI commands, it then:

1. Initializes a local repository and hires source and recipient agents.
2. Plans and applies one current workstream.
3. Creates and lists one assignment.
4. Inspects the objective, composed goal lifecycle, governed graph, and observed budgets.
5. Inspects an empty valid assignment thread and recipient inbox.
6. Renders a deterministic static operating board.
7. Inspects current operating attention through protocol v2.
8. Activates the v2 event writer, records a privacy-bounded root heartbeat, and inspects operating liveness through protocol v3.
9. Routes one reviewed direct-message artifact through exact plan/apply, proves source-event replay is current, records acknowledgment for the exact recipient-agent coordinate, and confirms delivery remains unobserved through protocol v4.

Acceptance uses no Hub, provider, network route, or connector effect. Cross-platform release matrices remain responsible for broader installation evidence.

## References

- [ADR-0355](../../decisions/execution/applications/0355-expose-versioned-packed-product-host-protocol.md)
- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0374](../../decisions/execution/applications/0374-project-operating-liveness-without-health-inference.md)
- [ADR-0375](../../decisions/execution/orchestration/governed-work/0375-route-reviewed-direct-messages-and-record-explicit-handoff-acknowledgment.md)
- [Operating attention](operating-attention.md)
- [Operating liveness](operating-liveness.md)
- [Operating goals](operating-goals.md)
- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Assignment interactions](assignment-interactions.md)
- [Reviewed direct-message triggers and handoff acknowledgment](assignment-message-triggers.md)
- [Assignment routines](assignment-routines.md)
- [Assignment connectors](assignment-connectors.md)

# Product-host protocol

Status: `active`

As of: 2026-09-04

## Purpose

The product-host protocol lets separately installed operating or collaboration products discover and compose Lervo through the installed `@lervo/cli` process, locally without a Hub, workspace-private imports, or access to storage internals.

Default discovery returns the 21-route `ProductHostCapabilityReportV1`:

```bash
lervo application capabilities --json
```

Additive version 2 requires an explicit request:

```bash
lervo application capabilities --protocol 2 --json
```

Version 2 appends read-only operating-attention and operating-goal routes and projections without changing version-1 discovery. Both reports are compatibility and discovery contracts, not authority grants, repository snapshots, or assertions that route prerequisites are satisfied.

## Report contract

Each report contains:

- a protocol-matching `schemaVersion` and `kind: product_host.capabilities`;
- protocol transport, version, discovery command, and `requiresHub: false`;
- canonical authority classes that products must not duplicate;
- rebuildable projection classes that products may render or transform;
- ordered route descriptors with area, operation, stable result-contract identifier, command prefix, output, effect, authority, and availability; and
- explicit unsupported product capabilities.

Command arrays omit the executable name and repository-specific arguments. Products invoke the installed `lervo` executable, add the route's required arguments, and request its declared output. Help text is human guidance, not the machine discovery contract.

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

The version 1 budget result preserves its total-token fields and adds discriminated token-dimension and duration assessments. These additions remain read-only and derive from the same governed-work policy. Hosts must treat `unknown` and `reached` as unsuccessful budget status.

Protocol v2 adds:

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `operating_attention.inspect` | `application attention --json` | read-only |
| `operating_goal.inspect` | `loop goal --json` | read-only |

### Collaboration

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `assignment_thread.inspect` | `loop thread` | read-only |
| `assignment_inbox.inspect` | `loop inbox` | read-only |
| `assignment_mention.route` | `assignment mention` | exact plan/apply |
| `assignment_connector.route` | `assignment connector` | injected adapter for effect |

Each route remains owned by its existing domain or adapter; the capability command does not centralize route policy.

## Authority and state

Repository state, workstreams, assignments, leases, events, verification, and artifacts remain canonical. Assignment graphs, operating goals, governed decisions, operating boards, threads, inboxes, and observed budgets are rebuildable projections. Products may cache presentation state but must not turn it into assignment, approval, completion, delivery, or verification authority.

An `available` route can still reject missing roles, workstreams, assignments, leases, approvals, verification, resources, or repository state. Products must preserve its exit status and typed result rather than convert an unavailable or invalid result into an empty success.

External connector effects remain unavailable in the stock CLI. Hosts injecting a connector must meet the separate descriptor, credential, destination, artifact, writing-permit, durable-reservation, unknown-effect, and common-conformance contracts.

## Unsupported capabilities

Versions 1 and 2 provide no product UI, product-owned task or chat database, unattended scheduler, dynamic graph mutation, implicit approval, or managed semantics for direct provider terminals. Consumers must not infer authority from a successful query or render. Protocol v2 attention and goal reports project existing sources and add no inbox, goal store, acknowledgment, resolution, or scheduling authority.

## External-consumer acceptance

`pnpm smoke:packed-cli` builds the real tarball, installs it into an empty temporary consumer, and runs the protocol without workspace imports. The fixture verifies the default 21-route v1 report, explicit 23-route v2 report, exact connector limitation, unsupported capabilities, absence of workspace coordinates, and absence of private Lervo package installation. Using only CLI commands, it then:

1. initializes a local repository and hires one agent;
2. plans and applies one current workstream;
3. creates and lists one assignment;
4. inspects the objective, composed goal lifecycle, governed graph, and observed budgets;
5. inspects an empty valid assignment thread and recipient inbox;
6. renders a deterministic static operating board; and
7. inspects current operating attention through protocol v2.

Acceptance uses no Hub, provider, network route, or connector effect. Cross-platform release matrices remain responsible for broader installation evidence.

## References

- [ADR-0355](../../decisions/execution/applications/0355-expose-versioned-packed-product-host-protocol.md)
- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [Operating attention](operating-attention.md)
- [Operating goals](operating-goals.md)
- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Assignment interactions](assignment-interactions.md)
- [Assignment routines](assignment-routines.md)
- [Assignment connectors](assignment-connectors.md)

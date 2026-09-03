# Product-host protocol

Status: `active`
As of: 2026-09-03

## Purpose

The product-host protocol lets a separately installed operating or collaboration product discover
and compose Lervo without importing workspace-private packages or accessing storage internals. The
version-1 transport is the installed `@lervo/cli` process. It works locally without a Hub.

Run:

```bash
lervo application capabilities --json
```

The result is a `ProductHostCapabilityReportV1`. It is a compatibility and discovery contract, not
an authority grant, repository snapshot, or assertion that route prerequisites are satisfied.

## Report contract

The report contains:

- `schemaVersion: 1` and `kind: product_host.capabilities`;
- protocol transport, version, discovery command, and `requiresHub: false`;
- the canonical authority classes that products must not duplicate;
- rebuildable projection classes that products may render or transform;
- ordered route descriptors with area, operation, stable result-contract identifier, command prefix,
  output, effect, authority, and availability; and
- explicit unsupported product capabilities.

Command arrays omit the executable name and repository-specific arguments. A product invokes the
installed `lervo` executable, adds the route's required arguments, and requests the declared output.
Help text remains human guidance and is not the machine discovery contract.

## Route inventory

### Workforce

| Route                           | CLI prefix               | Authority        |
| ------------------------------- | ------------------------ | ---------------- |
| `workforce_agent.inspect`       | `agent list --json`      | read-only        |
| `workforce_agent.hire`          | `agent hire`             | explicit write   |
| `workforce_agent.status`        | `agent status`           | explicit write   |
| `workforce_assignment.inspect`  | `assignment list --json` | read-only        |
| `workforce_assignment.create`   | `assignment create`      | explicit write   |
| `workforce_assignment.claim`    | `assignment claim`       | explicit write   |
| `workforce_assignment.renew`    | `assignment renew`       | explicit write   |
| `workforce_assignment.cancel`   | `assignment cancel`      | exact plan/apply |
| `workforce_assignment.handoff`  | `assignment handoff`     | explicit write   |
| `workforce_assignment.complete` | `assignment complete`    | explicit write   |

### Operating

| Route                            | CLI prefix              | Authority                     |
| -------------------------------- | ----------------------- | ----------------------------- |
| `operating_objective.inspect`    | `loop objective --json` | read-only                     |
| `governed_work.inspect`          | `loop status --json`    | read-only                     |
| `observed_budget.inspect`        | `loop budget --json`    | read-only                     |
| `operating_board.render`         | `loop board`            | read-only HTML                |
| `governed_attempt.execute`       | `loop run`              | lease-bound managed execution |
| `governed_completion.reconcile`  | `loop reconcile`        | exact plan/apply              |
| `assignment_routine.materialize` | `routine materialize`   | exact plan/apply              |

### Collaboration

| Route                        | CLI prefix             | Authority                   |
| ---------------------------- | ---------------------- | --------------------------- |
| `assignment_thread.inspect`  | `loop thread`          | read-only                   |
| `assignment_inbox.inspect`   | `loop inbox`           | read-only                   |
| `assignment_mention.route`   | `assignment mention`   | exact plan/apply            |
| `assignment_connector.route` | `assignment connector` | injected adapter for effect |

The route owner remains its existing domain or adapter. This inventory does not centralize their
policy in the capability command.

## Authority and state

Repository state, workstreams, assignments, leases, events, verification, and artifacts remain
canonical. Assignment graphs, governed decisions, operating boards, threads, inboxes, and observed
budgets are rebuildable projections. Product code may cache presentation state but must not turn it
into assignment, approval, completion, delivery, or verification authority.

An `available` route can still reject missing roles, workstreams, assignments, leases, approvals,
verification, resources, or repository state. Products must preserve its exit status and typed
result instead of converting an unavailable or invalid result into an empty success.

External connector effects remain unavailable in the stock CLI. A host that injects a connector
must meet the separate descriptor, credential, destination, artifact, writing-permit, durable
reservation, unknown-effect, and common conformance contracts.

## Unsupported capabilities

Version 1 does not provide a product UI, product-owned task or chat database, unattended scheduler,
dynamic graph mutation, implicit approval, or managed semantics for direct provider terminals.
These absences are explicit so a consumer cannot infer authority from a successful query or render.

## External-consumer acceptance

`pnpm smoke:packed-cli` builds the real tarball, installs it into an empty temporary consumer, and
runs the protocol without workspace imports. The fixture verifies all 21 descriptors, the exact
connector limitation, unsupported capabilities, no workspace coordinates, and no private Lervo
package installation. It then uses CLI commands only to:

1. initialize a local repository and hire one agent;
2. plan and apply one current workstream;
3. create and list one assignment;
4. inspect objective, governed graph, and observed budgets;
5. inspect an empty valid assignment thread and recipient inbox; and
6. render a deterministic static operating board.

The acceptance uses no Hub, provider, network route, or connector effect. Cross-platform release
matrices remain the owner of broader installation evidence.

## References

- [ADR-0355](../../decisions/execution/applications/0355-expose-versioned-packed-product-host-protocol.md)
- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Assignment interactions](assignment-interactions.md)
- [Assignment routines](assignment-routines.md)
- [Assignment connectors](assignment-connectors.md)

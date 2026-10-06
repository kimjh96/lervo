import type { NodeRuntimeComponentHealth, NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

/** Every Node health component that readiness judges, in receipt order. */
export const nodeReadinessComponents = [
  "sync",
  "workstreamReplication",
  "workspaceCoordination",
  "remoteControl",
  "conversation",
  "supervision",
] as const;

export type NodeReadinessComponent = (typeof nodeReadinessComponents)[number];

/**
 * The replacement must prove these components itself. Their readiness is what a repository Node
 * deployment exists to deliver, so a pre-existing failure is never carried over for them.
 */
const deliveryComponents: ReadonlySet<NodeReadinessComponent> = new Set([
  "sync",
  "workstreamReplication",
]);

/** Components whose exact `hub_unavailable` code an allowed offline replacement may accept. */
const hubDependentComponents: ReadonlySet<NodeReadinessComponent> = new Set([
  "sync",
  "workstreamReplication",
  "workspaceCoordination",
  "remoteControl",
]);

/**
 * The predecessor's component states, read before the service operation. `not_applicable` means
 * no service existed, `unavailable` that no valid snapshot was readable, and `stale` that the
 * snapshot was too old to describe the running predecessor.
 */
export type NodeReadinessBaseline =
  | { status: "not_applicable" | "unavailable" | "stale" }
  | {
      status: "observed";
      processId: number;
      startedAt: string;
      components: Record<NodeReadinessComponent, NodeRuntimeComponentHealth>;
    };

/** A non-ready component whose exact state the predecessor already had and still has. */
export interface NodeReadinessCarriedCondition {
  component: NodeReadinessComponent;
  status: "unavailable";
  failureCode: string;
  reasonCodes?: string[];
}

/** A component that kept the replacement from readiness, with the predecessor's state. */
export interface NodeReadinessBlocker {
  component: NodeReadinessComponent;
  observed: string;
  baseline: string | null;
}

export interface NodeReadinessEvaluation {
  complete: boolean;
  offline: boolean;
  /** Components in an accepted state; it only grows while startup makes progress. */
  acceptedCount: number;
  carried: NodeReadinessCarriedCondition[];
  blockers: NodeReadinessBlocker[];
}

export function nodeReadinessComponentHealth(
  snapshot: NodeRuntimeHealthSnapshot,
  component: NodeReadinessComponent,
): NodeRuntimeComponentHealth {
  return snapshot[component] ?? { status: "disabled" };
}

/** The bounded text form used in receipts, status reports, and failure messages. */
export function nodeReadinessComponentText(
  value: { status: string; failureCode?: string; reasonCode?: string } | undefined,
): string {
  return value === undefined
    ? "unavailable"
    : value.status === "unavailable"
      ? `unavailable:${value.failureCode ?? "unknown"}`
      : value.status === "dormant"
        ? `dormant:${value.reasonCode ?? "unknown"}`
        : value.status === "attention"
          ? `attention:${value.reasonCode ?? "unknown"}`
          : value.status;
}

/** Mirrors the runtime aggregate: which settled states count as healthy per component. */
function healthy(component: NodeReadinessComponent, health: NodeRuntimeComponentHealth): boolean {
  if (deliveryComponents.has(component)) return health.status === "ready";
  if (component === "supervision")
    return ["ready", "disabled", "dormant", "attention"].includes(health.status);
  return health.status === "ready" || health.status === "disabled";
}

function hubUnavailable(health: NodeRuntimeComponentHealth): boolean {
  return health.status === "unavailable" && health.failureCode === "hub_unavailable";
}

function carriedOver(
  component: NodeReadinessComponent,
  health: NodeRuntimeComponentHealth,
  baseline: NodeReadinessBaseline,
): NodeReadinessCarriedCondition | null {
  if (deliveryComponents.has(component) || baseline.status !== "observed") return null;
  const before = baseline.components[component];
  if (
    health.status !== "unavailable" ||
    before.status !== "unavailable" ||
    health.failureCode !== before.failureCode
  )
    return null;
  return {
    component,
    status: "unavailable",
    failureCode: health.failureCode,
    ...(health.reasonCodes === undefined ? {} : { reasonCodes: [...health.reasonCodes] }),
  };
}

/**
 * Judges one snapshot for regression, not perfection: every component must be healthy, carry the
 * exact non-ready state its predecessor already had, or report an allowed Hub outage.
 */
export function evaluateNodeReadiness(
  snapshot: NodeRuntimeHealthSnapshot,
  baseline: NodeReadinessBaseline,
  allowHubUnavailable: boolean,
): NodeReadinessEvaluation {
  let offline = false;
  let acceptedCount = 0;
  const carried: NodeReadinessCarriedCondition[] = [];
  const blockers: NodeReadinessBlocker[] = [];
  for (const component of nodeReadinessComponents) {
    const health = nodeReadinessComponentHealth(snapshot, component);
    if (healthy(component, health)) {
      acceptedCount += 1;
      continue;
    }
    if (allowHubUnavailable && hubDependentComponents.has(component) && hubUnavailable(health)) {
      offline = true;
      acceptedCount += 1;
      continue;
    }
    const condition = carriedOver(component, health, baseline);
    if (condition !== null) {
      acceptedCount += 1;
      carried.push(condition);
      continue;
    }
    blockers.push({
      component,
      observed: nodeReadinessComponentText(health),
      baseline:
        baseline.status === "observed"
          ? nodeReadinessComponentText(baseline.components[component])
          : null,
    });
  }
  return {
    complete:
      blockers.length === 0 && (snapshot.status === "ready" || snapshot.status === "degraded"),
    offline,
    acceptedCount,
    carried,
    blockers,
  };
}

export function nodeReadinessBaselineFrom(
  snapshot: NodeRuntimeHealthSnapshot,
): Extract<NodeReadinessBaseline, { status: "observed" }> {
  return {
    status: "observed",
    processId: snapshot.processId,
    startedAt: snapshot.startedAt,
    components: Object.fromEntries(
      nodeReadinessComponents.map((component) => [
        component,
        structuredClone(nodeReadinessComponentHealth(snapshot, component)),
      ]),
    ) as Record<NodeReadinessComponent, NodeRuntimeComponentHealth>,
  };
}

/** Renders blockers as `component=observed (baseline: state)` for bounded failure messages. */
export function describeNodeReadinessBlockers(blockers: readonly NodeReadinessBlocker[]): string {
  return blockers
    .map(
      (blocker) =>
        `${blocker.component}=${blocker.observed}${
          blocker.baseline === null ? "" : ` (baseline ${blocker.baseline})`
        }`,
    )
    .join(", ");
}

/**
 * True when an exact deployed runtime keeps its delivery components ready (or Hub-unavailable)
 * and every other non-ready component reports a settled condition, such as supervision attention
 * awaiting an owner decision. Replacing the runtime cannot resolve such a condition.
 */
export function nodeRuntimeHasOnlyAuxiliaryConditions(
  runtime: Record<NodeReadinessComponent, string> & { status: string },
): boolean {
  if (runtime.status !== "degraded") return false;
  const delivery = [runtime.sync, runtime.workstreamReplication];
  const auxiliary = [
    runtime.workspaceCoordination,
    runtime.remoteControl,
    runtime.conversation,
    runtime.supervision,
  ];
  return (
    delivery.every((value) => value === "ready" || value === "unavailable:hub_unavailable") &&
    auxiliary.every(
      (value) =>
        value === "ready" ||
        value === "disabled" ||
        /^(unavailable|dormant|attention):./u.test(value),
    ) &&
    auxiliary.some((value) => value.startsWith("unavailable:"))
  );
}

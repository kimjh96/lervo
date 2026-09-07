import type {
  AssignmentTopologyHistoryChangeV2,
  AssignmentTopologyHistoryV2,
} from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { assignmentTopologyDigest } from "./assignment-topology-validation.js";

interface TopologyNodeEvent {
  changeId: string;
  planId: string;
  approvalHash: string;
  reviewerIdDigest: string;
  requestHash: string;
  expectedNodeCount: number;
  nodeSetHash: string;
  nodeKey: string;
  assignmentId: string;
  occurredAt: string;
}

type TopologyNodeParseResult =
  { status: "not_topology" } | { status: "invalid" } | { status: "valid"; node: TopologyNodeEvent };

const HASH = /^sha256:[a-f0-9]{64}$/u;
const CHANGE_ID = /^gtc_[a-f0-9]{24}$/u;
const PLAN_ID = /^gtp_[a-f0-9]{24}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function topologyNode(event: EventEnvelope, workstreamId: string): TopologyNodeParseResult {
  if (event.type !== "assignment.created" || event.payload.workstreamId !== workstreamId)
    return { status: "not_topology" };
  const value = event.payload;
  if (value.topologyContractVersion === undefined) return { status: "not_topology" };
  if (
    value.topologyContractVersion !== 2 ||
    typeof value.topologyChangeKey !== "string" ||
    !KEY.test(value.topologyChangeKey) ||
    value.topologyChangeKey.length > 100 ||
    typeof value.topologyChangeId !== "string" ||
    !CHANGE_ID.test(value.topologyChangeId) ||
    typeof value.topologyPlanId !== "string" ||
    !PLAN_ID.test(value.topologyPlanId) ||
    typeof value.topologyApprovalHash !== "string" ||
    !HASH.test(value.topologyApprovalHash) ||
    typeof value.topologyReviewerIdDigest !== "string" ||
    !HASH.test(value.topologyReviewerIdDigest) ||
    typeof value.topologyRequestHash !== "string" ||
    !HASH.test(value.topologyRequestHash) ||
    typeof value.topologyExpectedNodeCount !== "number" ||
    !Number.isSafeInteger(value.topologyExpectedNodeCount) ||
    value.topologyExpectedNodeCount < 1 ||
    value.topologyExpectedNodeCount > 32 ||
    typeof value.topologyNodeSetHash !== "string" ||
    !HASH.test(value.topologyNodeSetHash) ||
    typeof value.topologyNodeKey !== "string" ||
    !KEY.test(value.topologyNodeKey) ||
    value.topologyNodeKey.length > 100 ||
    typeof value.assignmentId !== "string" ||
    !ASSIGNMENT_ID.test(value.assignmentId)
  ) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    node: {
      changeId: value.topologyChangeId,
      planId: value.topologyPlanId,
      approvalHash: value.topologyApprovalHash,
      reviewerIdDigest: value.topologyReviewerIdDigest,
      requestHash: value.topologyRequestHash,
      expectedNodeCount: value.topologyExpectedNodeCount,
      nodeSetHash: value.topologyNodeSetHash,
      nodeKey: value.topologyNodeKey,
      assignmentId: value.assignmentId,
      occurredAt: event.occurredAt,
    },
  };
}

export function projectAssignmentTopologyHistory(input: {
  events: readonly EventEnvelope[];
  workstreamId: string;
}): AssignmentTopologyHistoryV2 {
  const reasons = new Set<string>();
  const parsed = input.events.map((event) => topologyNode(event, input.workstreamId));
  if (parsed.some((item) => item.status === "invalid")) reasons.add("topology_history_malformed");
  const nodes = parsed.flatMap((item) => (item.status === "valid" ? [item.node] : []));
  const grouped = new Map<string, TopologyNodeEvent[]>();
  for (const node of nodes)
    grouped.set(node.changeId, [...(grouped.get(node.changeId) ?? []), node]);
  const changes: AssignmentTopologyHistoryChangeV2[] = [];
  for (const [changeId, entries] of [...grouped].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const first = entries[0]!;
    const nodeKeys = entries.map((entry) => entry.nodeKey);
    const assignments = entries.map((entry) => entry.assignmentId);
    if (
      new Set(nodeKeys).size !== nodeKeys.length ||
      new Set(assignments).size !== assignments.length
    )
      reasons.add("topology_history_duplicate_node");
    if (
      entries.some(
        (entry) =>
          entry.approvalHash !== first.approvalHash ||
          entry.reviewerIdDigest !== first.reviewerIdDigest ||
          entry.requestHash !== first.requestHash ||
          entry.expectedNodeCount !== first.expectedNodeCount ||
          entry.nodeSetHash !== first.nodeSetHash,
      )
    ) {
      reasons.add("topology_history_conflict");
      continue;
    }
    if (
      entries.length !== first.expectedNodeCount ||
      assignmentTopologyDigest([...nodeKeys].sort()) !== first.nodeSetHash
    ) {
      reasons.add("topology_change_incomplete");
      continue;
    }
    changes.push({
      changeId,
      planIds: [...new Set(entries.map((entry) => entry.planId))].sort(),
      approvalHash: first.approvalHash,
      reviewerIdDigest: first.reviewerIdDigest,
      assignmentIds: [...assignments].sort(),
      occurredAt: entries
        .map((entry) => entry.occurredAt)
        .sort()
        .at(-1)!,
    });
  }
  const reasonCodes = [...reasons].sort();
  return {
    schemaVersion: 2,
    status:
      reasonCodes.includes("topology_history_conflict") ||
      reasonCodes.includes("topology_history_duplicate_node") ||
      reasonCodes.includes("topology_history_malformed")
        ? "invalid"
        : reasonCodes.length > 0
          ? "recovery_required"
          : "valid",
    reasonCodes,
    changes,
  };
}

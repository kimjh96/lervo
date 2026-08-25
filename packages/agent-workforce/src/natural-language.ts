import { createHash } from "node:crypto";

import type { BuiltInRoleId } from "@lervo/roles";

import type { WorkforceAgent, WorkforceAssignment } from "./types.js";

const roleTerms: Record<BuiltInRoleId, readonly string[]> = {
  developer: ["developer", "engineer", "개발자", "개발"],
  researcher: ["researcher", "research", "리서처", "연구자", "연구"],
  marketer: ["marketer", "marketing", "마케터", "마케팅"],
  designer: ["designer", "design", "디자이너", "디자인"],
  writer: ["writer", "writing", "작가", "라이터", "문서"],
  ideation: ["ideation", "brainstorm", "아이디어", "브레인스토밍"],
};

export interface NaturalLanguageWorkforcePlan {
  schemaVersion: 1;
  planKind: "natural_language_workforce_request";
  requestDigest: string;
  intent: "hire" | "assign" | "inspect" | "resolve" | "handoff" | "retire" | "unrecognized";
  status: "ready" | "pending_decision" | "read_only" | "unrecognized";
  roleId: string | null;
  agentId: string | null;
  assignmentId: string | null;
  pending: Array<{
    field: "intent" | "role" | "agent" | "assignment" | "scope" | "authority";
    reason: string;
  }>;
  operation: {
    namespace: "agent" | "assignment" | "workstream";
    action: string;
    authority: "read" | "local_state_write" | "user_approval";
  } | null;
  privacy: { rawRequestPersisted: false; eventPayload: "digest_and_coordinates_only" };
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface NaturalLanguageRoleDescriptor {
  roleId: string;
  name: string;
  sourceKind: "built_in" | "repository";
}

function matchingRoles(request: string, roles: readonly NaturalLanguageRoleDescriptor[]): string[] {
  const lower = request.toLocaleLowerCase();
  const custom = roles
    .filter(
      (role) =>
        role.sourceKind === "repository" &&
        [role.roleId, role.name].some((term) => lower.includes(term.toLocaleLowerCase())),
    )
    .map((role) => role.roleId);
  if (custom.length > 0) return [...new Set(custom)];
  return (Object.entries(roleTerms) as Array<[BuiltInRoleId, readonly string[]]>)
    .filter(([, terms]) => terms.some((term) => lower.includes(term)))
    .map(([role]) => role);
}

function intent(request: string): NaturalLanguageWorkforcePlan["intent"] {
  const lower = request.toLocaleLowerCase();
  if (/\b(?:hire|recruit)\b|채용|고용/u.test(lower)) return "hire";
  if (/\b(?:retire|dismiss)\b|퇴직|은퇴|해고/u.test(lower)) return "retire";
  if (/\b(?:handoff|hand over)\b|인계/u.test(lower)) return "handoff";
  if (/\b(?:resolve|approve)\b|결정|승인/u.test(lower)) return "resolve";
  if (/\b(?:status|progress|inspect)\b|진행\s*(?:상황|상태)|상태/u.test(lower)) return "inspect";
  if (/\b(?:assign|delegate)\b|배정|맡(?:겨|기|아)/u.test(lower)) return "assign";
  return "unrecognized";
}

export function planNaturalLanguageWorkforceRequest(input: {
  request: string;
  agents: readonly WorkforceAgent[];
  assignments: readonly WorkforceAssignment[];
  roles?: readonly NaturalLanguageRoleDescriptor[];
}): NaturalLanguageWorkforcePlan {
  const request = input.request.trim();
  if (request.length < 1 || request.length > 4_096)
    throw new TypeError("The natural-language workforce request must be 1 to 4096 characters.");
  const selectedIntent = intent(request);
  const roles = matchingRoles(request, input.roles ?? []);
  const agentIds = [...request.matchAll(/\bagt_[a-f0-9]{24}\b/gu)].map((match) => match[0]!);
  const assignmentIds = [...request.matchAll(/\basn_[a-f0-9]{24}\b/gu)].map((match) => match[0]!);
  const roleId = roles.length === 1 ? roles[0]! : null;
  const agentId =
    agentIds.length === 1 && input.agents.some((agent) => agent.agentId === agentIds[0])
      ? agentIds[0]!
      : null;
  const assignmentId =
    assignmentIds.length === 1 &&
    input.assignments.some((assignment) => assignment.assignmentId === assignmentIds[0])
      ? assignmentIds[0]!
      : null;
  const pending: NaturalLanguageWorkforcePlan["pending"] = [];
  if (selectedIntent === "unrecognized")
    pending.push({
      field: "intent",
      reason: "No single supported workforce lifecycle intent was explicit.",
    });
  if (["hire", "assign"].includes(selectedIntent) && roles.length !== 1)
    pending.push({
      field: "role",
      reason:
        roles.length === 0 ? "The requested role is missing." : "More than one role is named.",
    });
  if (selectedIntent === "retire" && agentId === null)
    pending.push({ field: "agent", reason: "Retirement requires one existing exact agent ID." });
  if (selectedIntent === "handoff" && (agentIds.length !== 2 || assignmentId === null)) {
    if (assignmentId === null)
      pending.push({
        field: "assignment",
        reason: "Handoff requires one existing exact assignment ID.",
      });
    if (agentIds.length !== 2)
      pending.push({
        field: "agent",
        reason: "Handoff requires exact source and recipient agent IDs.",
      });
  }
  if (selectedIntent === "resolve" && assignmentId === null)
    pending.push({
      field: "assignment",
      reason: "Resolution requires one exact pending assignment or workstream item coordinate.",
    });
  if (selectedIntent === "assign" && !/(?:`[^`]+`|\bpath\s*[:=]|경로\s*[:=])/u.test(request))
    pending.push({
      field: "scope",
      reason: "The assignment write or evidence scope is not explicit.",
    });
  const operation =
    selectedIntent === "unrecognized"
      ? null
      : selectedIntent === "inspect"
        ? { namespace: "assignment" as const, action: "list", authority: "read" as const }
        : selectedIntent === "resolve"
          ? {
              namespace: "workstream" as const,
              action: "resolve_pending",
              authority: "user_approval" as const,
            }
          : selectedIntent === "handoff"
            ? {
                namespace: "assignment" as const,
                action: "handoff",
                authority: "local_state_write" as const,
              }
            : selectedIntent === "assign"
              ? {
                  namespace: "assignment" as const,
                  action: "create",
                  authority: "local_state_write" as const,
                }
              : {
                  namespace: "agent" as const,
                  action: selectedIntent,
                  authority: "local_state_write" as const,
                };
  return {
    schemaVersion: 1,
    planKind: "natural_language_workforce_request",
    requestDigest: digest(request),
    intent: selectedIntent,
    status:
      selectedIntent === "unrecognized"
        ? "unrecognized"
        : pending.length > 0
          ? "pending_decision"
          : selectedIntent === "inspect"
            ? "read_only"
            : "ready",
    roleId,
    agentId,
    assignmentId,
    pending,
    operation,
    privacy: { rawRequestPersisted: false, eventPayload: "digest_and_coordinates_only" },
  };
}

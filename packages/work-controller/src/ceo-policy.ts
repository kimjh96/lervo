import type {
  CeoCommandDecision,
  CeoCommandRequest,
  CeoPolicy,
  OrganizationOperatingReport,
} from "@lervo/application-contract";

import { digest } from "./hash.js";
import { createOrganizationOperatingReport } from "./organization-operating-report.js";

const AGENT_ID = /^agt_[a-f0-9]{24}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ORGANIZATION_ID = /^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const TEAM_ID = /^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const REQUEST_ID = /^ceor_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const actions = new Set([
  "team.propose",
  "agent.hire",
  "assignment.delegate",
  "deliberation.convene",
  "conversation.channel.create",
  "conversation.thread.create",
  "agent.deployment.prepare",
]);

function decision(
  request: CeoCommandRequest,
  policy: CeoPolicy,
  status: CeoCommandDecision["status"],
  reason: CeoCommandDecision["reason"],
): CeoCommandDecision {
  const content = {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    policyId: policy.policyId,
    status,
    reason,
  };
  return { ...content, decisionHash: digest(content) };
}

function validPolicy(policy: CeoPolicy): boolean {
  return (
    typeof policy === "object" &&
    policy !== null &&
    policy.schemaVersion === 1 &&
    /^ceop_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(policy.policyId) &&
    ORGANIZATION_ID.test(policy.organizationId) &&
    AGENT_ID.test(policy.appointedAgentId) &&
    Number.isSafeInteger(policy.maximumAutomationDepth) &&
    policy.maximumAutomationDepth >= 0 &&
    policy.maximumAutomationDepth <= 8 &&
    HASH.test(policy.budgetPolicyHash) &&
    Array.isArray(policy.allowedActions) &&
    policy.allowedActions.every((action) => actions.has(action)) &&
    new Set(policy.allowedActions).size === policy.allowedActions.length &&
    Array.isArray(policy.approvalRequiredActions) &&
    policy.approvalRequiredActions.every((action) => policy.allowedActions.includes(action)) &&
    Array.isArray(policy.allowedTeamIds) &&
    new Set(policy.allowedTeamIds).size === policy.allowedTeamIds.length &&
    policy.allowedTeamIds.every((teamId) => TEAM_ID.test(teamId))
  );
}

function validRequest(request: CeoCommandRequest): boolean {
  return (
    typeof request === "object" &&
    request !== null &&
    request.schemaVersion === 1 &&
    REQUEST_ID.test(request.requestId) &&
    ORGANIZATION_ID.test(request.organizationId) &&
    AGENT_ID.test(request.requestedByAgentId) &&
    actions.has(request.action) &&
    (request.teamId === null || TEAM_ID.test(request.teamId)) &&
    ["low", "medium", "high"].includes(request.risk) &&
    Number.isSafeInteger(request.automationDepth) &&
    request.automationDepth >= 0 &&
    request.automationDepth <= 8 &&
    typeof request.budget === "object" &&
    request.budget !== null &&
    ["within", "reached", "unknown"].includes(request.budget.status) &&
    HASH.test(request.budget.policyHash) &&
    (request.approvalId === null ||
      /^apr_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(request.approvalId))
  );
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validTeam(team: OrganizationOperatingReport["teams"][number]): boolean {
  if (typeof team !== "object" || team === null) return false;
  const { snapshotHash, ...content } = team;
  return (
    ORGANIZATION_ID.test(team.organizationId) &&
    TEAM_ID.test(team.teamId) &&
    ["central", "project"].includes(team.teamKind) &&
    /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(team.projectId) &&
    HASH.test(team.repositoryIdentityHash) &&
    validCount(team.membershipCounts?.active) &&
    validCount(team.membershipCounts?.suspended) &&
    validCount(team.membershipCounts?.ended) &&
    validCount(team.deploymentCounts?.active) &&
    validCount(team.deploymentCounts?.retired) &&
    validCount(team.activeChannelMembershipCount) &&
    validCount(team.activeDeliberationCount) &&
    validCount(team.activeAgentContextEntryCount) &&
    validCount(team.sourceHeadSequence) &&
    (team.currentWorkstream === null ||
      (typeof team.currentWorkstream === "object" &&
        team.currentWorkstream !== null &&
        /^wks_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(team.currentWorkstream.workstreamId) &&
        Number.isSafeInteger(team.currentWorkstream.revision) &&
        team.currentWorkstream.revision >= 1 &&
        typeof team.currentWorkstream.status === "string")) &&
    HASH.test(snapshotHash) &&
    digest(content) === snapshotHash
  );
}

function validIssue(issue: OrganizationOperatingReport["issues"][number]): boolean {
  if (typeof issue !== "object" || issue === null || typeof issue.code !== "string") return false;
  if (issue.code === "missing_central_team") return issue.teamId === null;
  if (issue.code === "duplicate_project") {
    return /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(issue.projectId);
  }
  return (
    ["organization_mismatch", "duplicate_team"].includes(issue.code) && TEAM_ID.test(issue.teamId)
  );
}

function validOrganization(report: OrganizationOperatingReport): boolean {
  if (typeof report !== "object" || report === null) return false;
  const { reportHash: _reportHash, ...content } = report;
  const structurallyValid =
    report.schemaVersion === 1 &&
    ORGANIZATION_ID.test(report.organizationId) &&
    ["current", "incomplete", "conflict"].includes(report.status) &&
    Array.isArray(report.teams) &&
    report.teams.every(validTeam) &&
    Array.isArray(report.issues) &&
    report.issues.every(validIssue) &&
    HASH.test(report.reportHash) &&
    digest(content) === report.reportHash;
  if (!structurallyValid) return false;
  return (
    createOrganizationOperatingReport({
      organizationId: report.organizationId,
      teams: report.teams.map(({ snapshotHash: _snapshotHash, ...team }) => team),
    }).reportHash === report.reportHash
  );
}

export function decideCeoCommand(input: {
  policy: CeoPolicy;
  request: CeoCommandRequest;
  organization: OrganizationOperatingReport;
}): CeoCommandDecision {
  const { policy, request, organization } = input;
  if (!validPolicy(policy)) throw new TypeError("The CEO policy contract is invalid.");
  if (!validRequest(request)) throw new TypeError("The CEO request contract is invalid.");
  if (!validOrganization(organization)) {
    throw new TypeError("The organization operating report contract is invalid.");
  }
  if (
    request.organizationId !== policy.organizationId ||
    organization.organizationId !== policy.organizationId
  ) {
    return decision(request, policy, "denied", "organization_mismatch");
  }
  if (organization.status === "conflict") {
    return decision(request, policy, "denied", "operating_projection_conflict");
  }
  if (request.requestedByAgentId !== policy.appointedAgentId) {
    return decision(request, policy, "denied", "appointment_mismatch");
  }
  if (!policy.allowedActions.includes(request.action)) {
    return decision(request, policy, "denied", "action_not_allowed");
  }
  if (request.teamId !== null && !policy.allowedTeamIds.includes(request.teamId)) {
    return decision(request, policy, "denied", "team_not_allowed");
  }
  if (request.automationDepth > policy.maximumAutomationDepth) {
    return decision(request, policy, "denied", "automation_depth_exceeded");
  }
  if (request.budget.policyHash !== policy.budgetPolicyHash) {
    return decision(request, policy, "denied", "budget_policy_mismatch");
  }
  if (request.budget.status === "reached") {
    return decision(request, policy, "denied", "budget_reached");
  }
  if (request.budget.status === "unknown") {
    return decision(request, policy, "denied", "budget_unknown");
  }
  if (
    (request.risk === "high" || policy.approvalRequiredActions.includes(request.action)) &&
    request.approvalId === null
  ) {
    return decision(request, policy, "approval_required", "approval_missing");
  }
  return decision(request, policy, "allowed", "policy_allows");
}

import { registerAgent, type WorkforceAgent, type WorkforceProvider } from "@lervo/agent-workforce";
import { ensureTemplateRole, resolveRoleContract } from "@lervo/roles";

import { noticeEffect } from "./effect-notice.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export interface AgentHireRequest {
  roleId: string;
  provider: WorkforceProvider;
  displayName?: string;
  responsibilityPaths: string[];
  capabilityPackageIds?: string[];
  parentAgentId?: string;
}

/**
 * Hires an agent, as `lervo agent hire` and the core link's `agent.hire` do. A project without a
 * template role, such as `product-owner`, gets it on its first hire, reported after the fact with
 * an undo that retires the agent.
 */
export async function hireAgent(root: string, request: AgentHireRequest): Promise<WorkforceAgent> {
  const template = await ensureTemplateRole(root, request.roleId);
  await resolveRoleContract(root, request.roleId);
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    registerAgent({
      repositoryRoot: root,
      roleId: request.roleId,
      provider: request.provider,
      ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
      responsibilityPaths: request.responsibilityPaths,
      // The owner hires the team (ADR-0643); a Lervo service hires its own workers elsewhere.
      origin: "team",
      ...(request.capabilityPackageIds === undefined
        ? {}
        : { capabilityPackageIds: request.capabilityPackageIds }),
      ...(request.parentAgentId === undefined ? {} : { parentAgentId: request.parentAgentId }),
      recordEvent,
    }),
  );
  if (template === "written")
    await noticeEffect({
      repositoryRoot: root,
      effect: "role_template_written",
      subject: `${agent.roleId}:${agent.agentId}`,
      targets: [`.lervo/roles/${agent.roleId}.json`],
      reason: "first_hire_of_template_role",
      reviewers: ["role_contract_resolved"],
      verdict: "verified",
      undo: `lervo agent status --agent ${agent.agentId} --status retired --revision ${agent.revision} --write`,
    });
  return agent;
}

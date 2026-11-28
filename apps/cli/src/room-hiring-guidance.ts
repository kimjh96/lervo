// What a hosted session learns about hiring when its agent's role may hire (ADR-0662): a hire is
// named like a person, and its specialty is its role, never its name.
import { listAgents } from "@lervo/agent-workforce";
import {
  grantsRequestType,
  HIRING_REQUEST_TYPE,
  ORGANIZATION_REQUEST_TYPE,
  resolveRoleContract,
  type ResolvedRoleContract,
} from "@lervo/roles";

const PROVIDERS = new Set(["claude", "codex"]);

/**
 * The hiring lines for an agent whose role carries `agent.hire`, or null for any other agent. An
 * agent whose role also carries `organization.coordinate` learns to add a project role when no
 * role fits; any other hiring agent asks one that can.
 */
export function hiringGuidance(
  contract: ResolvedRoleContract,
  provider: string | undefined,
): string | null {
  if (!grantsRequestType(contract, HIRING_REQUEST_TYPE)) return null;
  const providerFlag =
    provider !== undefined && PROVIDERS.has(provider) ? ` --provider ${provider}` : "";
  return [
    `When the work needs a teammate the team lacks, hire one: run \`lervo role list --json\`, then \`lervo agent hire --role <role ID> --name <nickname>${providerFlag} --write --json\`. Name each hire like a person, such as Bora or Haru, never by its specialty: the specialty is its role, and the name is how the team mentions it.`,
    grantsRequestType(contract, ORGANIZATION_REQUEST_TYPE)
      ? 'When no role fits the specialty, add a project role from the closest template first: `lervo role add --name "<specialty>" --description "<what it owns and decides>" --from <template role ID> --write --json`, then hire with the role ID it answers. A teammate whose specialty moves runs `lervo agent role --agent <agent ID> --role <role ID> --revision <n> --write`.'
      : "When no role fits the specialty, ask the product owner to add one; your role cannot add roles.",
  ].join("\n");
}

/** The hiring lines for the session's own agent, or null when it may not hire or cannot be read. */
export async function hiringGuidanceFor(
  repositoryRoot: string | undefined,
  agentId: string,
  provider: string | undefined,
): Promise<string | null> {
  if (repositoryRoot === undefined) return null;
  const agent = (await listAgents(repositoryRoot, { readOnly: true })).find(
    (candidate) => candidate.agentId === agentId,
  );
  if (agent === undefined) return null;
  return hiringGuidance(await resolveRoleContract(repositoryRoot, agent.roleId), provider);
}

// The model and effort an agent's hosted session launches with (ADR-0647).
import { type HostedEffort, type HostedSessionAdapter } from "@lervo/adapter-contract";
import { agentModel, listAgents } from "@lervo/agent-workforce";

/**
 * The launch's `model` and `effort` for the agent `agentId`: its own choice, or its role's, in the
 * provider's names. Nothing when no agent runs the session, the agent is unknown, or the provider
 * cannot be told which model to run, so its own default runs.
 */
export async function agentLaunchModel(
  repositoryRoot: string,
  agentId: string | undefined,
  adapter: HostedSessionAdapter,
): Promise<{ model?: string; effort?: HostedEffort }> {
  if (agentId === undefined || adapter.models === undefined) return {};
  const agents = await listAgents(repositoryRoot, { readOnly: true }).catch(() => []);
  const agent = agents.find((candidate) => candidate.agentId === agentId);
  if (agent === undefined) return {};
  const chosen = agentModel(agent);
  return { model: adapter.models[chosen.tier].model, effort: chosen.effort };
}

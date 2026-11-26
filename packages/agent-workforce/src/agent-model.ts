// Each team agent's model and effort (ADR-0647): chosen by its role when it is hired, and changed
// by the owner.
import { registry } from "./agent-registry.js";
import {
  type AgentModel,
  type ModelEffort,
  type ModelTier,
  type WorkforceAgent,
  type WorkforceEventRecorder,
  modelEfforts,
  modelTiers,
} from "./types.js";
import { AGENT_ID, fail } from "./workforce-state-validation.js";
import { transition } from "./workforce-state-io.js";

/**
 * What each built-in role's work asks of a model. Deciding and researching weigh judgment over
 * speed; code repays extra effort most; writing and ideas do well on a balanced model. A role the
 * table does not name, such as a repository's own, gets a strong model at high effort.
 */
const ROLE_MODELS: Readonly<Record<string, { tier: ModelTier; effort: ModelEffort }>> = {
  "product-owner": { tier: "strong", effort: "high" },
  ceo: { tier: "strong", effort: "high" },
  developer: { tier: "strong", effort: "xhigh" },
  researcher: { tier: "strong", effort: "high" },
  designer: { tier: "strong", effort: "high" },
  ideation: { tier: "balanced", effort: "high" },
  writer: { tier: "balanced", effort: "medium" },
  marketer: { tier: "balanced", effort: "medium" },
};
const OTHER_ROLES = { tier: "strong", effort: "high" } as const;

/** The model and effort a role's agents start with. */
export function roleModel(roleId: string): AgentModel {
  return { ...(ROLE_MODELS[roleId] ?? OTHER_ROLES), source: "role" };
}

/** The model and effort an agent's sessions run with: its own, or its role's. */
export function agentModel(agent: Pick<WorkforceAgent, "roleId" | "model">): AgentModel {
  return agent.model ?? roleModel(agent.roleId);
}

/**
 * Sets a team agent's model and effort as the owner chose them. The change applies from the
 * agent's next session; a running session keeps the model it started with.
 */
export async function changeAgentModel(input: {
  repositoryRoot: string;
  agentId: string;
  expectedRevision: number;
  tier: ModelTier;
  effort: ModelEffort;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (
    !AGENT_ID.test(input.agentId) ||
    !modelTiers.includes(input.tier) ||
    !modelEfforts.includes(input.effort)
  )
    fail("agent_invalid", "The agent model transition is invalid.");
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = current.value.agents[index]!;
  const previous = agentModel(existing);
  if (
    existing.revision !== input.expectedRevision ||
    existing.status === "retired" ||
    existing.origin === "lervo"
  )
    fail("agent_state_conflict", "The agent revision, lifecycle, or origin conflicts.");
  const agent: WorkforceAgent = {
    ...existing,
    model: { tier: input.tier, effort: input.effort, source: "owner" },
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  };
  const agents = current.value.agents.map((candidate, candidateIndex) =>
    candidateIndex === index ? agent : candidate,
  );
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.identity.changed",
      occurredAt: agent.updatedAt,
      actorAgentId: input.actorAgentId ?? null,
      payload: {
        changeKind: "model",
        agentId: agent.agentId,
        previousModelTier: previous.tier,
        previousEffort: previous.effort,
        modelTier: input.tier,
        effort: input.effort,
        revision: agent.revision,
      },
    },
  });
}

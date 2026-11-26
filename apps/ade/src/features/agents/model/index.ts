/**
 * The agents feature's model surface. Other features' models import it here rather than through
 * the feature's index.ts, which also loads its views (ADE convention, "Features in the UI").
 */
export { showProjectAgents } from "./controller";
export { bindProfile, closeProfile, openProfile } from "./store";
export {
  HIRE_PRODUCT_OWNER,
  PRODUCT_OWNER_ROLE,
  defaultParticipants,
  proposesProductOwner,
  managesAgents,
  takesParticipants,
  teamAgents,
} from "./decisions";
export { useAgentStore } from "./store";
export { type AgentMarkDependencies, bindAgentMarks } from "./marks";

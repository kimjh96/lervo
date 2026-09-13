import type {
  AssignmentTopologyChangeRequestV2,
  AssignmentTopologyPlanV2,
} from "./assignment-topology.js";
import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** One automatic addition per decision; manual v2 retains its separate batch approval. */
export interface AutomaticTopologyEffectV1 {
  schemaVersion: 1;
  kind: "assignment_topology.automatic_effect";
  request: AssignmentTopologyChangeRequestV2;
  topology: AssignmentTopologyPlanV2;
  responsibility: WorkResponsibilityV1;
  provider: string;
  reservedTokens: number;
}

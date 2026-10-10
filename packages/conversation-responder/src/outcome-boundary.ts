import type { WritingArtifactCoordinate } from "@lervo/writing";
import { ManagedConversationResponseError, type ManagedConversationResponsePlan } from "./types.js";

/** Both generated and cached artifacts cross the same current completion boundary. */
export async function verifyConversationOutcome(
  plan: ManagedConversationResponsePlan,
  artifact: WritingArtifactCoordinate,
): Promise<void> {
  if (plan.contextQuality && !(await plan.contextQuality.observe(artifact)).completionAllowed)
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "Required conversation outcome verification did not pass.",
    );
}

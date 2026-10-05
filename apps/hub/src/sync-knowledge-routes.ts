import {
  handleKnowledgeConvergenceOwnerMutation,
  handleKnowledgeConvergenceOwnerRead,
  handleKnowledgeInstructionCandidateList,
  handleKnowledgeInstructionCandidatePublish,
  type HubKnowledgeConvergenceOwnerStore,
  type HubKnowledgeInstructionCandidateStore,
} from "@lervo/hub-sync";

import type { HubSyncHttpRoute } from "./sync-request.js";

/**
 * Serves the cross-host knowledge coordination routes: the ADR-0466 convergence owner lease and
 * the ADR-0467 owner-rule candidate exchange. Returns false for any other route. Authentication,
 * permission, and error translation stay with the sync handler.
 */
export async function serveKnowledgeSyncRoute(input: {
  route: HubSyncHttpRoute;
  method: string | undefined;
  query: { destinationId: string; projectIdentityHash: string };
  store: HubKnowledgeConvergenceOwnerStore & HubKnowledgeInstructionCandidateStore;
  acceptedAt: string;
  readBody(): Promise<unknown>;
  send(status: number, body: unknown): void;
}): Promise<boolean> {
  const coordinate = {
    destinationId: input.query.destinationId,
    projectId: input.route.projectId,
    repositoryIdentityHash: input.query.projectIdentityHash,
  };
  const repository = {
    projectId: input.route.projectId,
    repositoryIdentityHash: input.query.projectIdentityHash,
  };
  if (input.route.kind === "knowledge-convergence-owner") {
    if (input.method === "GET") {
      input.send(
        200,
        await handleKnowledgeConvergenceOwnerRead({
          store: input.store,
          coordinate,
          acceptedAt: input.acceptedAt,
        }),
      );
      return true;
    }
    const result = await handleKnowledgeConvergenceOwnerMutation({
      store: input.store,
      destinationId: input.query.destinationId,
      coordinate: repository,
      mutation: await input.readBody(),
      acceptedAt: input.acceptedAt,
    });
    input.send(result.status === "granted" ? 201 : 200, result);
    return true;
  }
  if (input.route.kind === "knowledge-instruction-candidates") {
    if (input.method === "GET") {
      input.send(
        200,
        await handleKnowledgeInstructionCandidateList({ store: input.store, coordinate }),
      );
      return true;
    }
    const result = await handleKnowledgeInstructionCandidatePublish({
      store: input.store,
      destinationId: input.query.destinationId,
      coordinate: repository,
      record: await input.readBody(),
      acceptedAt: input.acceptedAt,
    });
    input.send(result.status === "created" ? 201 : 200, result);
    return true;
  }
  return false;
}

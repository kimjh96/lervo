import {
  handleWorkstreamPublish,
  handleWorkstreamRead,
  handleWorkstreamRevisionRead,
  type HubWorkstreamReplicationStore,
} from "@lervo/hub-sync";
import { type WorkstreamReplicationPublishRequest, validateSchema } from "@lervo/schemas";

import { InvalidHubHttpRequestError } from "./request.js";
import { hubWorkstreamRevisionQuery, type HubSyncHttpRoute } from "./sync-request.js";

/**
 * Serves workstream replication: the current head read, ADR-0561's exact stored-revision read, and
 * publication. Returns false for any other route. Authentication, permission, and error
 * translation stay with the sync handler.
 */
export async function serveWorkstreamSyncRoute(input: {
  route: HubSyncHttpRoute;
  method: string | undefined;
  parameters: URLSearchParams;
  query: { destinationId: string; projectIdentityHash: string };
  expectedRegistrationId: string;
  store: HubWorkstreamReplicationStore;
  acceptedAt: string;
  readBody(): Promise<unknown>;
  send(status: number, body: unknown): void;
}): Promise<boolean> {
  if (input.route.kind !== "workstreams") return false;
  const coordinate = {
    store: input.store,
    destinationId: input.query.destinationId,
    projectId: input.route.projectId,
    repositoryIdentityHash: input.query.projectIdentityHash,
  };
  if (input.method === "GET") {
    const snapshotContentHash = hubWorkstreamRevisionQuery(input.parameters);
    input.send(
      200,
      snapshotContentHash === null
        ? await handleWorkstreamRead(coordinate)
        : await handleWorkstreamRevisionRead({ ...coordinate, snapshotContentHash }),
    );
    return true;
  }
  const body = await input.readBody();
  if (!validateSchema("workstreamReplicationPublishRequest", body).valid)
    throw new InvalidHubHttpRequestError();
  const publication = body as WorkstreamReplicationPublishRequest;
  if (
    publication.projectId !== input.route.projectId ||
    publication.repositoryIdentityHash !== input.query.projectIdentityHash ||
    publication.registrationId !== input.expectedRegistrationId
  )
    throw new InvalidHubHttpRequestError();
  const result = await handleWorkstreamPublish({
    store: input.store,
    destinationId: input.query.destinationId,
    request: publication,
    publishedAt: input.acceptedAt,
  });
  input.send(result.status === "created" ? 201 : 200, result);
  return true;
}

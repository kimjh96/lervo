import {
  HubWorkspaceCoordinationError,
  isHubWorkspaceReservationRelease,
  isHubWorkspaceReservationRenewal,
  isHubWorkspaceReservationRequest,
  isHubWorkspaceSummary,
  type HubWorkspaceCoordinationStore,
  type HubWorkspaceReservationDecision,
  type HubWorkspaceReservationRelease,
  type HubWorkspaceReservationRenewal,
  type HubWorkspaceReservationRequest,
  type HubWorkspaceSummary,
} from "./workspace-coordination.js";

export type HubWorkspaceCoordinationMutation =
  | { operation: "reserve"; request: HubWorkspaceReservationRequest }
  | { operation: "renew"; request: HubWorkspaceReservationRenewal }
  | { operation: "release"; request: HubWorkspaceReservationRelease };

function validAcceptedAt(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isHubWorkspaceCoordinationMutation(
  value: unknown,
): value is HubWorkspaceCoordinationMutation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const mutation = value as Partial<HubWorkspaceCoordinationMutation>;
  if (mutation.operation === "reserve")
    return isHubWorkspaceReservationRequest(mutation.request as HubWorkspaceReservationRequest);
  if (mutation.operation === "renew")
    return isHubWorkspaceReservationRenewal(mutation.request as HubWorkspaceReservationRenewal);
  if (mutation.operation === "release")
    return isHubWorkspaceReservationRelease(mutation.request as HubWorkspaceReservationRelease);
  return false;
}

export async function handleWorkspaceCoordinationMutation(input: {
  store: HubWorkspaceCoordinationStore;
  destinationId: string;
  mutation: HubWorkspaceCoordinationMutation;
  acceptedAt: string;
}): Promise<
  HubWorkspaceReservationDecision | { status: "renewed" | "released"; reservation: unknown }
> {
  if (!validAcceptedAt(input.acceptedAt))
    throw new HubWorkspaceCoordinationError(
      "workspace_coordination_invalid",
      "The workspace coordination acceptance time is invalid.",
    );
  if (input.mutation.operation === "reserve")
    return input.store.reserveWorkspace({
      destinationId: input.destinationId,
      request: input.mutation.request,
      acceptedAt: input.acceptedAt,
    });
  if (input.mutation.operation === "renew")
    return {
      status: "renewed",
      reservation: await input.store.renewWorkspaceReservation({
        destinationId: input.destinationId,
        request: input.mutation.request,
        acceptedAt: input.acceptedAt,
      }),
    };
  return {
    status: "released",
    reservation: await input.store.releaseWorkspaceReservation({
      destinationId: input.destinationId,
      request: input.mutation.request,
      acceptedAt: input.acceptedAt,
    }),
  };
}

export async function handleWorkspaceSummaryPublish(input: {
  store: HubWorkspaceCoordinationStore;
  destinationId: string;
  summary: HubWorkspaceSummary;
  acceptedAt: string;
}) {
  if (!isHubWorkspaceSummary(input.summary) || !validAcceptedAt(input.acceptedAt))
    throw new HubWorkspaceCoordinationError(
      "workspace_coordination_invalid",
      "The workspace summary publication is invalid.",
    );
  return input.store.publishWorkspaceSummary(input);
}

export async function handleWorkspaceSummaryRead(input: {
  store: HubWorkspaceCoordinationStore;
  destinationId: string;
  projectId: string;
  repositoryIdentityHash: string;
  acceptedAt: string;
}) {
  if (!validAcceptedAt(input.acceptedAt))
    throw new HubWorkspaceCoordinationError(
      "workspace_coordination_invalid",
      "The workspace summary read time is invalid.",
    );
  return input.store.listWorkspaceSummaries(input);
}

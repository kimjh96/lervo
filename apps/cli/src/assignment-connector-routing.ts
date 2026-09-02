import type {
  AssignmentConnectorPortV1,
  AssignmentConnectorRequestV1,
  AssignmentConnectorRouteResultV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  assertAssignmentConnectorDeliveryObservation,
  assertAssignmentConnectorReservation,
  createAssignmentConnectorRoutePlan,
} from "@lervo/work-controller";

import { observeAssignmentConnectorSource } from "./assignment-connector-source.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

async function currentPlan(repositoryRoot: string, request: AssignmentConnectorRequestV1) {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null || workstream.status !== "active")
      throw new Error("Assignment connector routing requires a verified active workstream.");
    return createAssignmentConnectorRoutePlan({
      currentWorkstreamId: workstream.workstreamId,
      request,
      source: await observeAssignmentConnectorSource(storage, request),
    });
  } finally {
    await storage.close();
  }
}

export async function routeAssignmentConnector(input: {
  repositoryRoot: string;
  request: AssignmentConnectorRequestV1;
  applyPlanId?: string;
  connector?: AssignmentConnectorPortV1;
}): Promise<AssignmentConnectorRouteResultV1> {
  const inspectedPlan = await currentPlan(input.repositoryRoot, input.request);
  if (input.applyPlanId === undefined) return { plan: inspectedPlan, delivery: null };
  if (inspectedPlan.planId !== input.applyPlanId)
    throw new Error("The assignment connector route plan is stale.");
  if (inspectedPlan.status !== "ready")
    throw new Error(
      `The assignment connector route is blocked: ${inspectedPlan.blockedReasons.join(", ")}.`,
    );
  if (input.connector === undefined)
    throw new Error("No assignment connector adapter is configured for external delivery.");

  const inspectedBoundary = await input.connector.inspect({
    connectorId: inspectedPlan.connectorId,
    destinationId: inspectedPlan.destinationId,
  });
  const freshRequest: AssignmentConnectorRequestV1 = {
    ...input.request,
    descriptor: inspectedBoundary.descriptor,
    destination: inspectedBoundary.destination,
  };
  const freshPlan = await currentPlan(input.repositoryRoot, freshRequest);
  if (freshPlan.planId !== input.applyPlanId)
    throw new Error("The assignment connector adapter boundary differs from the reviewed plan.");
  const reservation = assertAssignmentConnectorReservation(
    freshPlan,
    await input.connector.reserve(freshPlan),
  );
  if (reservation.status === "conflict")
    throw new Error(
      "The assignment connector delivery reservation conflicts with another attempt.",
    );
  if (reservation.status === "current")
    return { plan: freshPlan, delivery: reservation.observation };
  const delivery = assertAssignmentConnectorDeliveryObservation(
    freshPlan,
    await input.connector.deliver({ plan: freshPlan, reservationId: reservation.reservationId }),
  );
  return { plan: freshPlan, delivery };
}

export type RouteAssignmentConnector = typeof routeAssignmentConnector;

import type {
  AssignmentConnectorDeliveryObservationV1,
  AssignmentConnectorRequestV1,
  AssignmentConnectorSourceObservationV1,
} from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import {
  assertAssignmentConnectorDeliveryObservation,
  assertAssignmentConnectorReservation,
  createAssignmentConnectorRoutePlan,
} from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;
const workstreamId = "wks_abcdefabcdefabcdefabcdef";

function fixture(): {
  request: AssignmentConnectorRequestV1;
  source: AssignmentConnectorSourceObservationV1;
} {
  const request: AssignmentConnectorRequestV1 = {
    schemaVersion: 1,
    workstreamId,
    assignmentId: "asn_abcdefabcdefabcdefabcdef",
    handoffId: "hnd_abcdefabcdefabcdefabcdef",
    handoffEventId: "evt_abcdefabcdefabcdefabcdef",
    artifactId: "art_assignment_handoff_01",
    contentHash: hash("a"),
    requestDigest: hash("b"),
    descriptor: {
      schemaVersion: 1,
      connectorId: "con_chat_primary",
      connectorVersion: "1.0.0",
      descriptorHash: hash("c"),
      availability: "available",
      authentication: "adapter_verified",
      replayProtection: "durable_pre_send",
      externalIdentifiers: "adapter_private",
      capabilities: ["artifact.send"],
    },
    destination: {
      schemaVersion: 1,
      connectorId: "con_chat_primary",
      destinationId: "dst_review_team",
      integrationId: "int_chat_primary",
      bindingHash: hash("d"),
      status: "active",
    },
    publication: {
      surface: "chat",
      permitId: "permit_assignment_handoff",
      permitHash: hash("e"),
      artifactId: "art_assignment_handoff_01",
      contentHash: hash("a"),
    },
  };
  return {
    request,
    source: {
      projectId: "prj_abcdefabcdefabcd",
      workstreamId,
      assignmentId: request.assignmentId,
      assignmentRevision: 3,
      handoffId: request.handoffId,
      handoffEventId: request.handoffEventId,
      fromAgentId: "agt_assignment_source",
      toAgentId: "agt_assignment_recipient",
      requestDigest: request.requestDigest,
      artifactReferences: [{ artifactId: request.artifactId, contentHash: request.contentHash }],
      routeRecordedAt: "2026-09-02T05:00:00.000Z",
    },
  };
}

function plan() {
  const input = fixture();
  return createAssignmentConnectorRoutePlan({ currentWorkstreamId: workstreamId, ...input });
}

function delivered(): AssignmentConnectorDeliveryObservationV1 {
  const routePlan = plan();
  return {
    schemaVersion: 1,
    planId: routePlan.planId,
    outboundId: routePlan.outboundId,
    connectorId: routePlan.connectorId,
    destinationId: routePlan.destinationId,
    status: "delivered",
    reservationId: "acres_delivery_01",
    attemptDigest: routePlan.attemptDigest,
    deliveryReceiptHash: hash("f"),
    deliveryKeyHash: hash("0"),
    attemptedAt: "2026-09-02T05:01:00.000Z",
    deliveredAt: "2026-09-02T05:01:01.000Z",
    failureCode: null,
  };
}

describe("assignment connector route planning", () => {
  it("binds one routed artifact and internal destination into deterministic identifiers", () => {
    const first = plan();
    const second = plan();
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ready",
      connectorId: "con_chat_primary",
      destinationId: "dst_review_team",
      blockedReasons: [],
    });
    expect(JSON.stringify(first)).not.toContain("slack");
  });

  it("fails closed on source, publication, event, and routed artifact mismatches", () => {
    const input = fixture();
    input.source.assignmentId = "asn_111111111111111111111111";
    input.source.handoffEventId = "evt_111111111111111111111111";
    input.source.artifactReferences = [];
    input.request.publication.contentHash = hash("9");
    expect(() =>
      createAssignmentConnectorRoutePlan({ currentWorkstreamId: workstreamId, ...input }),
    ).toThrow(/source observation/u);

    input.source.artifactReferences = [{ artifactId: "art_other", contentHash: hash("8") }];
    expect(
      createAssignmentConnectorRoutePlan({ currentWorkstreamId: workstreamId, ...input }),
    ).toMatchObject({
      status: "blocked",
      blockedReasons: [
        "artifact_not_routed",
        "handoff_event_mismatch",
        "publication_mismatch",
        "source_mismatch",
      ],
    });
  });

  it("keeps unavailable connectors, inactive destinations, and workstreams distinct", () => {
    const input = fixture();
    input.request.descriptor.availability = "unavailable";
    input.request.destination.status = "inactive";
    input.source.workstreamId = "wks_111111111111111111111111";
    expect(
      createAssignmentConnectorRoutePlan({ currentWorkstreamId: workstreamId, ...input }),
    ).toMatchObject({
      status: "blocked",
      blockedReasons: ["connector_unavailable", "destination_inactive", "workstream_mismatch"],
    });
  });

  it("accepts exact delivery evidence and rejects foreign or contradictory outcomes", () => {
    const observation = delivered();
    expect(assertAssignmentConnectorDeliveryObservation(plan(), observation)).toEqual(observation);
    for (const status of ["rejected", "unknown"] as const) {
      const terminal: AssignmentConnectorDeliveryObservationV1 = {
        ...observation,
        status,
        deliveryReceiptHash: null,
        deliveryKeyHash: null,
        deliveredAt: null,
        failureCode:
          status === "rejected" ? "platform_delivery_rejected" : "platform_delivery_unknown",
      };
      expect(assertAssignmentConnectorDeliveryObservation(plan(), terminal)).toEqual(terminal);
    }
    expect(() =>
      assertAssignmentConnectorDeliveryObservation(plan(), {
        ...observation,
        outboundId: "acout_foreign",
      }),
    ).toThrow(/foreign or invalid/u);
    expect(() =>
      assertAssignmentConnectorDeliveryObservation(plan(), {
        ...observation,
        status: "unknown",
        failureCode: "platform_delivery_unknown",
      }),
    ).toThrow(/contradictory/u);
  });

  it("requires exact durable authorization evidence before delivery", () => {
    const routePlan = plan();
    expect(
      assertAssignmentConnectorReservation(routePlan, {
        status: "reserved",
        reservationId: "acres_assignment_route_01",
        attemptDigest: routePlan.attemptDigest,
        authorizationReceiptHash: hash("7"),
        reservedAt: "2026-09-02T05:00:01.000Z",
      }),
    ).toMatchObject({ status: "reserved" });
    expect(() =>
      assertAssignmentConnectorReservation(routePlan, {
        status: "reserved",
        reservationId: "acres_assignment_route_01",
        attemptDigest: hash("6"),
        authorizationReceiptHash: hash("7"),
        reservedAt: "2026-09-02T05:00:01.000Z",
      }),
    ).toThrow(/reservation evidence/u);
  });

  it("rejects malformed descriptor authentication before planning", () => {
    const input = fixture();
    (input.request.descriptor as { authentication: string }).authentication = "caller_claimed";
    expect(() =>
      createAssignmentConnectorRoutePlan({ currentWorkstreamId: workstreamId, ...input }),
    ).toThrow(/descriptor/u);
  });
});

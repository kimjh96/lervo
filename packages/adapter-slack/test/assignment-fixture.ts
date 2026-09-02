import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  AssignmentConnectorDescriptorV1,
  AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";
import type {
  AssignmentConnectorConformanceHarnessV1,
  AssignmentConnectorConformanceScenarioV1,
} from "@lervo/assignment-connector-conformance";
import { canonicalJson } from "@lervo/event-contract";
import type { WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId, writingSha256 } from "@lervo/writing-contract";
import { createAssignmentConnectorRoutePlan } from "@lervo/work-controller";

import {
  SlackAssignmentConnector,
  SqliteSlackAssignmentConnectorState,
  createConfiguredSlackAssignmentDestinationSource,
  createConfiguredSlackAssignmentPermitSource,
  createEnvironmentSlackAssignmentCredentialSource,
  type SlackAssignmentConnectorStateV1,
  type SlackAssignmentTransportV1,
} from "../src/index.js";

export const CONNECTOR_ID = "con_slack_assignment";
export const DESTINATION_ID = "dst_slack_review";
export const INTEGRATION_ID = "int_slack_primary";
export const TEAM_ID = "T123ABC";
export const CHANNEL_ID = "C456DEF";
export const BOT_TOKEN = "xoxb-fixture-secret-token-value";
export const MESSAGE_TS = "1788336000.123456";
export const ARTIFACT_ID = "art_slackassignment01";
export const ARTIFACT_TEXT = "Review the verified assignment handoff.";
export const ARTIFACT_BYTES = new TextEncoder().encode(ARTIFACT_TEXT);
export const CONTENT_HASH = writingSha256(ARTIFACT_BYTES);

function permit(): WritingPublicationPermit {
  const content: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface: "chat",
    artifactId: ARTIFACT_ID,
    contentHash: CONTENT_HASH,
    writingPolicyId: "writing_en-human",
    writingPolicyHash: writingSha256("writing-policy"),
    evaluationId: "wre_slackassignment01",
    evaluationHash: writingSha256("writing-evaluation"),
    issuedAt: "2026-09-02T08:00:00.000Z",
  };
  return { ...content, permitId: calculateWritingPublicationPermitId(content) };
}

export const FIXTURE_PERMIT = permit();
export const PERMIT_HASH = writingSha256(canonicalJson(FIXTURE_PERMIT));

function connectorRequest(input: {
  descriptor: AssignmentConnectorDescriptorV1;
  destination: Awaited<ReturnType<SlackAssignmentConnector["inspect"]>>["destination"];
}) {
  return {
    schemaVersion: 1 as const,
    workstreamId: "wks_111111111111111111111111",
    assignmentId: "asn_222222222222222222222222",
    handoffId: "hnd_slackassignment01",
    handoffEventId: "evt_slackassignment01",
    artifactId: ARTIFACT_ID,
    contentHash: CONTENT_HASH,
    requestDigest: writingSha256("request"),
    descriptor: input.descriptor,
    destination: input.destination,
    publication: {
      surface: "chat" as const,
      permitId: FIXTURE_PERMIT.permitId,
      permitHash: PERMIT_HASH,
      artifactId: ARTIFACT_ID,
      contentHash: CONTENT_HASH,
    },
  };
}

export interface SlackAssignmentFixture {
  harness: AssignmentConnectorConformanceHarnessV1;
  connector: SlackAssignmentConnector;
  state: SqliteSlackAssignmentConnectorState;
  root: string;
  attempts(): number;
}

export async function createSlackAssignmentFixture(
  scenario: AssignmentConnectorConformanceScenarioV1 = "delivered",
): Promise<SlackAssignmentFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-slack-assignment-"));
  const state = SqliteSlackAssignmentConnectorState.open(resolve(root, "delivery.sqlite"));
  let attempts = 0;
  let reservedBeforeEffect = false;
  let descriptorDrift = false;
  let destinationDrift = false;
  let plan: AssignmentConnectorRoutePlanV1;
  const configuredDestinations = createConfiguredSlackAssignmentDestinationSource({
    connectorId: CONNECTOR_ID,
    destinations: [
      {
        destinationId: DESTINATION_ID,
        integrationId: INTEGRATION_ID,
        status: "active",
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
        threadTs: null,
      },
    ],
  });
  const destinations = {
    resolve: async (input: { connectorId: string; destinationId: string }) => {
      const result = await configuredDestinations.resolve(input);
      if (!destinationDrift) return result;
      return {
        ...result,
        public: { ...result.public, bindingHash: writingSha256("destination drift") },
        channelId: "C999XYZ",
      };
    },
  };
  const configuredCredentials = createEnvironmentSlackAssignmentCredentialSource({
    integrationId: INTEGRATION_ID,
    credentialId: "cred_slack_primary",
    teamId: scenario === "authorization_failed" ? "T999XYZ" : TEAM_ID,
    tokenEnvironmentVariable: "LERVO_TEST_SLACK_TOKEN",
    environment: { LERVO_TEST_SLACK_TOKEN: BOT_TOKEN },
  });
  const credentials = {
    resolve: async (input: { integrationId: string }) =>
      descriptorDrift ? ({ status: "unavailable" } as const) : configuredCredentials.resolve(input),
  };
  const transport: SlackAssignmentTransportV1 = {
    send: async () => {
      attempts += 1;
      reservedBeforeEffect = state.inspectStatus(plan.outboundId) === "sending";
      if (scenario === "rejected") return { status: "rejected" };
      if (scenario === "unknown") return { status: "unknown" };
      return {
        status: "delivered",
        messageTs: MESSAGE_TS,
        deliveredAt: "2026-09-02T08:00:02.000Z",
      };
    },
  };
  let clock = 0;
  const connectorState: SlackAssignmentConnectorStateV1 =
    scenario === "contradictory_evidence"
      ? {
          reserve: async ({ plan: requestedPlan }) => ({
            status: "current",
            observation: {
              schemaVersion: 1,
              planId: requestedPlan.planId,
              outboundId: requestedPlan.outboundId,
              connectorId: requestedPlan.connectorId,
              destinationId: requestedPlan.destinationId,
              status: "delivered",
              reservationId: "acres_contradictory",
              attemptDigest: requestedPlan.attemptDigest,
              deliveryReceiptHash: null,
              deliveryKeyHash: null,
              attemptedAt: "2026-09-02T08:00:01.000Z",
              deliveredAt: null,
              failureCode: null,
            },
          }),
          beginDelivery: (input) => state.beginDelivery(input),
          complete: (value) => state.complete(value),
        }
      : state;
  const connector = new SlackAssignmentConnector({
    connectorId: CONNECTOR_ID,
    credentials,
    destinations,
    artifacts: { read: async () => ARTIFACT_BYTES },
    permits: createConfiguredSlackAssignmentPermitSource({ permits: [FIXTURE_PERMIT] }),
    state: connectorState,
    transport,
    now: () => new Date(Date.parse("2026-09-02T08:00:00.000Z") + clock++ * 1_000),
  });
  const boundary = await connector.inspect({
    connectorId: CONNECTOR_ID,
    destinationId: DESTINATION_ID,
  });
  const request = connectorRequest(boundary);
  plan = createAssignmentConnectorRoutePlan({
    currentWorkstreamId: request.workstreamId,
    request,
    source: {
      projectId: "prj_3333333333333333",
      workstreamId: request.workstreamId,
      assignmentId: request.assignmentId,
      assignmentRevision: 4,
      handoffId: request.handoffId,
      handoffEventId: request.handoffEventId,
      fromAgentId: "agt_slackassignment01",
      toAgentId: "agt_slackassignment02",
      requestDigest: request.requestDigest,
      artifactReferences: [{ artifactId: ARTIFACT_ID, contentHash: CONTENT_HASH }],
      routeRecordedAt: "2026-09-02T07:59:00.000Z",
    },
  });
  descriptorDrift = scenario === "descriptor_drift";
  destinationDrift = scenario === "destination_drift";
  if (scenario === "conflict") {
    await state.reserve({
      plan,
      reservationId: "acres_conflicting_fixture",
      authorizationReceiptHash: writingSha256("different authorization"),
      reservedAt: "2026-09-02T08:00:00.000Z",
    });
  }
  const harness: AssignmentConnectorConformanceHarnessV1 = {
    port: connector,
    plan,
    externalAttemptCount: () => attempts,
    reservationPersistedBeforeEffect: () => reservedBeforeEffect,
    privateMarkers: [BOT_TOKEN, TEAM_ID, CHANNEL_ID, MESSAGE_TS],
    durableEvidence: () => state.listEvidence(),
  };
  return { harness, connector, state, root, attempts: () => attempts };
}

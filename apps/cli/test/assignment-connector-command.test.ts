import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  AssignmentConnectorDeliveryObservationV1,
  AssignmentConnectorPortV1,
  AssignmentConnectorRequestV1,
} from "@lervo/application-contract";
import {
  SlackAssignmentConnector,
  SqliteSlackAssignmentConnectorState,
  createArtifactStoreSlackAssignmentSource,
  createConfiguredSlackAssignmentDestinationSource,
  createConfiguredSlackAssignmentPermitSource,
  createEnvironmentSlackAssignmentCredentialSource,
} from "@lervo/adapter-slack";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import type { WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId, writingSha256 } from "@lervo/writing-contract";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
const hash = (value: string) => `sha256:${value.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function outputIo(root: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd: root,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

async function setupRoute(
  root: string,
  artifact = { artifactId: "art_connectorroute01", contentHash: hash("a") },
) {
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], quiet)).toBe(0);
  const draft = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: "Assignment connector",
    objective: "Deliver one canonical handoff artifact through an injected connector.",
    nextActions: [],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: new Date().toISOString(),
  });
  const workstreamOutput = outputIo(root);
  expect(
    await runCli(["workstream", "start", "--stdin", "--json"], {
      ...workstreamOutput.io,
      stdin: async () => draft,
    }),
  ).toBe(0);
  const workstream = JSON.parse(workstreamOutput.stdout.join("")) as {
    planId: string;
    snapshot: { workstreamId: string };
  };
  expect(
    await runCli(["workstream", "start", "--stdin", "--apply", workstream.planId], {
      ...quiet,
      stdin: async () => draft,
    }),
  ).toBe(0);
  const agents: string[] = [];
  for (const role of ["developer", "researcher"]) {
    const output = outputIo(root);
    expect(await runCli(["agent", "hire", "--role", role, "--write", "--json"], output.io)).toBe(0);
    agents.push((JSON.parse(output.stdout.join("")) as { agentId: string }).agentId);
  }
  const assignmentOutput = outputIo(root);
  expect(
    await runCli(
      [
        "assignment",
        "create",
        "--type",
        "implementation",
        "--role",
        "developer",
        "--criteria",
        "Route one connector artifact.",
        "--suite",
        "project.quick",
        "--path",
        "src/connector.ts",
        "--workstream",
        workstream.snapshot.workstreamId,
        "--write",
        "--json",
      ],
      assignmentOutput.io,
    ),
  ).toBe(0);
  const assignmentId = (JSON.parse(assignmentOutput.stdout.join("")) as { assignmentId: string })
    .assignmentId;
  const claimOutput = outputIo(root);
  expect(
    await runCli(
      [
        "assignment",
        "claim",
        "--assignment",
        assignmentId,
        "--agent",
        agents[0]!,
        "--session",
        "ses_connectorroute01",
        "--write",
        "--json",
      ],
      claimOutput.io,
    ),
  ).toBe(0);
  const leaseId = (JSON.parse(claimOutput.stdout.join("")) as { lease: { leaseId: string } }).lease
    .leaseId;
  const mentionOutput = outputIo(root);
  const mentionArgs = [
    "assignment",
    "mention",
    "--assignment",
    assignmentId,
    "--from-agent",
    agents[0]!,
    "--mention",
    `@agent:${agents[1]!}`,
    "--lease",
    leaseId,
    "--request-digest",
    hash("b"),
    "--artifact",
    `${artifact.artifactId}=${artifact.contentHash}`,
  ];
  expect(await runCli([...mentionArgs, "--json"], mentionOutput.io)).toBe(0);
  const mentionPlanId = (JSON.parse(mentionOutput.stdout.join("")) as { plan: { planId: string } })
    .plan.planId;
  expect(await runCli([...mentionArgs, "--apply", mentionPlanId, "--write"], quiet)).toBe(0);
  const storage = await openProjectStorage(root);
  try {
    const event = storage.events
      .list({ afterSeq: 0, limit: 1000 })
      .find(
        (item) =>
          item.type === "assignment.handoff.recorded" &&
          (item.payload as Record<string, unknown>).assignmentId === assignmentId,
      );
    if (event === undefined) throw new Error("Missing handoff fixture event.");
    return {
      assignmentId,
      handoffEventId: event.eventId,
      workstreamId: workstream.snapshot.workstreamId,
    };
  } finally {
    await storage.close();
  }
}

describe("assignment connector command", () => {
  it("plans without authority and delivers idempotently through an injected connector", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-connector-"));
    roots.push(root);
    const route = await setupRoute(root);
    const descriptor = {
      schemaVersion: 1 as const,
      connectorId: "con_chat_primary",
      connectorVersion: "1.0.0",
      descriptorHash: hash("c"),
      availability: "available" as const,
      authentication: "adapter_verified" as const,
      replayProtection: "durable_pre_send" as const,
      externalIdentifiers: "adapter_private" as const,
      capabilities: ["artifact.send"] as ["artifact.send"],
    };
    const destination = {
      schemaVersion: 1 as const,
      connectorId: descriptor.connectorId,
      destinationId: "dst_review_team",
      integrationId: "int_chat_primary",
      bindingHash: hash("d"),
      status: "active" as const,
    };
    const request: AssignmentConnectorRequestV1 = {
      schemaVersion: 1,
      workstreamId: route.workstreamId,
      assignmentId: route.assignmentId,
      handoffId: "",
      handoffEventId: route.handoffEventId,
      artifactId: "art_connectorroute01",
      contentHash: hash("a"),
      requestDigest: hash("b"),
      descriptor,
      destination,
      publication: {
        surface: "chat",
        permitId: "permit_assignment_handoff",
        permitHash: hash("e"),
        artifactId: "art_connectorroute01",
        contentHash: hash("a"),
      },
    };
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events.get(route.handoffEventId)!;
      request.handoffId = (event.payload as Record<string, string>).handoffId!;
    } finally {
      await storage.close();
    }
    const requestPath = resolve(root, "connector-request.json");
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    const args = ["assignment", "connector", "--from", requestPath];
    const plannedOutput = outputIo(root);
    expect(await runCli([...args, "--json"], plannedOutput.io)).toBe(0);
    const planned = JSON.parse(plannedOutput.stdout.join("")) as {
      plan: { planId: string; status: string };
    };
    expect(planned.plan.status).toBe("ready");

    const unavailable = outputIo(root);
    expect(await runCli([...args, "--apply", planned.plan.planId, "--write"], unavailable.io)).toBe(
      1,
    );
    expect(unavailable.stderr.join("")).toContain("No assignment connector adapter");

    let observation: AssignmentConnectorDeliveryObservationV1 | null = null;
    let deliveries = 0;
    const connector: AssignmentConnectorPortV1 = {
      inspect: async () => ({ descriptor, destination }),
      reserve: async (plan) =>
        observation === null
          ? {
              status: "reserved",
              reservationId: "acres_connector_route_01",
              attemptDigest: plan.attemptDigest,
              authorizationReceiptHash: hash("f"),
              reservedAt: "2026-09-02T06:00:00.000Z",
            }
          : { status: "current", observation },
      deliver: async ({ plan, reservationId }) => {
        deliveries += 1;
        observation = {
          schemaVersion: 1,
          planId: plan.planId,
          outboundId: plan.outboundId,
          connectorId: plan.connectorId,
          destinationId: plan.destinationId,
          status: "delivered",
          reservationId,
          attemptDigest: plan.attemptDigest,
          deliveryReceiptHash: hash("1"),
          deliveryKeyHash: hash("2"),
          attemptedAt: "2026-09-02T06:00:01.000Z",
          deliveredAt: "2026-09-02T06:00:02.000Z",
          failureCode: null,
        };
        return observation;
      },
    };
    for (let index = 0; index < 2; index += 1) {
      const output = outputIo(root);
      expect(
        await runCli([...args, "--apply", planned.plan.planId, "--write", "--json"], output.io, {
          assignmentConnectorPort: connector,
        }),
        output.stderr.join(""),
      ).toBe(0);
      expect(JSON.parse(output.stdout.join("")).delivery.status).toBe("delivered");
    }
    expect(deliveries).toBe(1);
  });

  it("dogfoods the production Slack connector through explicit host injection", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-slack-"));
    roots.push(root);
    const artifactId = "art_slackconnector01";
    const artifactText = "Review the verified assignment handoff.";
    const contentHash = writingSha256(artifactText);
    const route = await setupRoute(root, { artifactId, contentHash });
    const storage = await openProjectStorage(root);
    const stored = await storage.artifacts.put(artifactText);
    expect(stored.contentHash).toBe(contentHash);

    const permitContent: Omit<WritingPublicationPermit, "permitId"> = {
      schemaVersion: 1,
      surface: "chat",
      artifactId,
      contentHash,
      writingPolicyId: "writing_en-human",
      writingPolicyHash: writingSha256("policy"),
      evaluationId: "wre_slackconnector01",
      evaluationHash: writingSha256("evaluation"),
      issuedAt: "2026-09-02T08:00:00.000Z",
    };
    const permit = {
      ...permitContent,
      permitId: calculateWritingPublicationPermitId(permitContent),
    };
    let sends = 0;
    const state = SqliteSlackAssignmentConnectorState.open(
      resolve(root, ".lervo/state/slack-assignment-delivery.sqlite"),
    );
    const connector = new SlackAssignmentConnector({
      connectorId: "con_slack_assignment",
      credentials: createEnvironmentSlackAssignmentCredentialSource({
        integrationId: "int_slack_primary",
        credentialId: "cred_slack_primary",
        teamId: "T123ABC",
        tokenEnvironmentVariable: "LERVO_TEST_SLACK_TOKEN",
        environment: { LERVO_TEST_SLACK_TOKEN: "xoxb-fixture-secret-token-value" },
      }),
      destinations: createConfiguredSlackAssignmentDestinationSource({
        connectorId: "con_slack_assignment",
        destinations: [
          {
            destinationId: "dst_slack_review",
            integrationId: "int_slack_primary",
            status: "active",
            teamId: "T123ABC",
            channelId: "C456DEF",
            threadTs: null,
          },
        ],
      }),
      artifacts: createArtifactStoreSlackAssignmentSource({
        artifactStore: storage.artifacts,
        coordinates: [{ artifactId, uri: stored.uri }],
      }),
      permits: createConfiguredSlackAssignmentPermitSource({ permits: [permit] }),
      state,
      transport: {
        send: async () => {
          sends += 1;
          return {
            status: "delivered",
            messageTs: "1788336000.123456",
            deliveredAt: "2026-09-02T08:00:02.000Z",
          };
        },
      },
      now: () => new Date("2026-09-02T08:00:01.000Z"),
    });
    try {
      const boundary = await connector.inspect({
        connectorId: "con_slack_assignment",
        destinationId: "dst_slack_review",
      });
      const event = storage.events.get(route.handoffEventId)!;
      const request: AssignmentConnectorRequestV1 = {
        schemaVersion: 1,
        workstreamId: route.workstreamId,
        assignmentId: route.assignmentId,
        handoffId: (event.payload as Record<string, string>).handoffId!,
        handoffEventId: route.handoffEventId,
        artifactId,
        contentHash,
        requestDigest: hash("b"),
        ...boundary,
        publication: {
          surface: "chat",
          permitId: permit.permitId,
          permitHash: writingSha256(canonicalJson(permit)),
          artifactId,
          contentHash,
        },
      };
      const requestPath = resolve(root, "slack-connector-request.json");
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
      const args = ["assignment", "connector", "--from", requestPath];
      const plannedOutput = outputIo(root);
      expect(await runCli([...args, "--json"], plannedOutput.io)).toBe(0);
      const planId = (JSON.parse(plannedOutput.stdout.join("")) as { plan: { planId: string } })
        .plan.planId;
      for (let index = 0; index < 2; index += 1) {
        const output = outputIo(root);
        expect(
          await runCli([...args, "--apply", planId, "--write", "--json"], output.io, {
            assignmentConnectorPort: connector,
          }),
          output.stderr.join(""),
        ).toBe(0);
        expect(JSON.parse(output.stdout.join("")).delivery.status).toBe("delivered");
      }
      expect(sends).toBe(1);
      expect(JSON.stringify(state.listEvidence())).not.toContain("T123ABC");
      expect(JSON.stringify(state.listEvidence())).not.toContain("C456DEF");
    } finally {
      state.close();
      await storage.close();
    }
  });
});

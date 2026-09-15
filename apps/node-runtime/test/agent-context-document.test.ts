import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  renderAgentContextDocument,
  selectAgentContextEntries,
} from "../src/agent-context-document.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const agentId = `agt_${"a".repeat(24)}`;
const inheritedAgentId = `agt_${"b".repeat(24)}`;

function entry(
  id: string,
  owner: string,
  promotedAt: string,
  status: "active" | "superseded",
  overrides: Partial<{
    sensitivity: "internal" | "restricted";
    expiresAt: string | null;
    retrievalDigests: string[];
  }> = {},
) {
  return {
    contextEntryId: `actx_${id.repeat(24)}`,
    agentId: owner,
    layer: "expertise" as const,
    memoryKind: "expertise" as const,
    subjectKey: `testing-${id}`,
    audience: "agent" as const,
    sensitivity: overrides.sensitivity ?? ("internal" as const),
    confidence: "high" as const,
    retrievalDigests: overrides.retrievalDigests ?? [
      `sha256:${createHash("sha256").update("testing").digest("hex")}`,
    ],
    observedAt: promotedAt,
    expiresAt: overrides.expiresAt ?? null,
    reviewBindingVersion: 2 as const,
    source: {
      kind: "artifact" as const,
      sourceId: `art_${"1".repeat(64)}`,
      contentHash: hash("1"),
    },
    summaryArtifactId: `art_${"2".repeat(64)}`,
    summaryContentHash: hash("2"),
    summaryByteCount: 10,
    reviewEventId: "evt_review0001",
    reviewEventHash: hash("3"),
    supersedesContextEntryId: null,
    promotedAt,
    status,
  };
}

describe("agent context document", () => {
  it("bounds active owned and explicitly inherited entries before rendering", () => {
    const owned = entry("1", agentId, "2026-09-09T00:00:00.000Z", "active");
    const superseded = entry("2", agentId, "2026-09-08T00:00:00.000Z", "superseded");
    const inherited = entry("3", inheritedAgentId, "2026-09-10T00:00:00.000Z", "active");
    const context = {
      schemaVersion: 1 as const,
      projectId: "prj_context0001",
      agent: {
        agentId,
        roleId: "developer",
        roleVersion: "1.0.0",
        roleContractHash: hash("4"),
        roleProfileHash: hash("5"),
        provider: "any" as const,
        responsibilityPaths: ["."],
        parentAgentId: null,
        status: "active" as const,
      },
      readOnly: false,
      entries: [owned, superseded],
      inheritedEntries: [inherited],
      incomingHandoffs: [],
      outgoingHandoffs: [],
      lastSequence: 42,
    };
    const selected = selectAgentContextEntries(context, 2, {
      query: "testing",
      at: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(selected.map((item) => item.contextEntryId)).toEqual([
      inherited.contextEntryId,
      owned.contextEntryId,
    ]);
    const document = JSON.parse(
      renderAgentContextDocument({
        context,
        organization: {
          schemaVersion: 1,
          projectId: context.projectId,
          team: null,
          memberships: [],
          deployments: [],
          channelMemberships: [],
          deliberationParticipants: [],
          teamKindRevision: 0,
          lastSequence: 42,
        },
        entries: selected.map((item) => ({
          contextEntryId: item.contextEntryId,
          ownerAgentId: item.agentId,
          layer: item.layer,
          memoryKind: item.memoryKind,
          subjectKey: item.subjectKey,
          confidence: item.confidence,
          observedAt: item.observedAt,
          expiresAt: item.expiresAt,
          source: item.source,
          promotedAt: item.promotedAt,
          summary: "Reviewed expertise",
        })),
      }),
    ) as Record<string, unknown>;
    expect(document).toMatchObject({
      kind: "lervo_agent_context_projection",
      sourceEventHeadSequence: 42,
      entries: [{ ownerAgentId: inheritedAgentId }, { ownerAgentId: agentId }],
    });
  });

  it("excludes unrelated, expired, and restricted entries from provider injection", () => {
    const relevant = entry("4", agentId, "2026-09-10T00:00:00.000Z", "active");
    const expired = entry("5", agentId, "2026-09-09T00:00:00.000Z", "active", {
      expiresAt: "2026-09-10T12:00:00.000Z",
    });
    const restricted = entry("6", agentId, "2026-09-10T00:00:00.000Z", "active", {
      sensitivity: "restricted",
    });
    const unrelated = entry("7", agentId, "2026-09-10T00:00:00.000Z", "active", {
      retrievalDigests: [hash("f")],
    });
    const context = {
      schemaVersion: 1 as const,
      projectId: "prj_context0001",
      agent: {
        agentId,
        roleId: "developer",
        roleVersion: "1.0.0",
        roleContractHash: hash("4"),
        roleProfileHash: hash("5"),
        provider: "any" as const,
        responsibilityPaths: ["."],
        parentAgentId: null,
        status: "active" as const,
      },
      readOnly: false,
      entries: [relevant, expired, restricted, unrelated],
      inheritedEntries: [],
      incomingHandoffs: [],
      outgoingHandoffs: [],
      lastSequence: 42,
    };

    expect(
      selectAgentContextEntries(context, 8, {
        query: "testing",
        at: new Date("2026-09-11T00:00:00.000Z"),
      }).map((item) => item.contextEntryId),
    ).toEqual([relevant.contextEntryId]);
  });
});

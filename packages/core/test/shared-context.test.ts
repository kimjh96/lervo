import type {
  ContextEvidence,
  HandoffBundle,
  RoleProfile,
  SharedContextPublication,
} from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  decideSharedContextAccess,
  evaluateWriteContext,
  resolveHandoffContext,
} from "../src/index.js";

const contentHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const policyVersion = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function researcherRole(allowedRoleIds = ["marketer"]): RoleProfile {
  return {
    schemaVersion: 1,
    roleId: "researcher",
    name: "Researcher",
    description: "근거가 있는 조사 결과를 공유합니다.",
    requestTypes: ["research"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "allow",
      "shell.execute": "allow",
      "network.access": "allow",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "research_finding",
      schemaRef: "roven-schema://outputs/research-finding/v1",
      pathTemplate: ".roven/generated/research/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: "writing_ko-kr-human",
      },
    },
    verification: {
      suiteIds: ["research.sources"],
      failureDisposition: "fail_run",
    },
    handoff: {
      allowedRoleIds,
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}

function publication(
  overrides: Partial<SharedContextPublication> = {},
): SharedContextPublication {
  return {
    schemaVersion: 1,
    sharedContextId: "scx_research_finding",
    projectId: "prj_01234567",
    kind: "finding",
    documentId: "doc_research_finding",
    contentHash,
    sourceRevision: "working-tree:research-v1",
    producer: {
      kind: "agent",
      roleId: "researcher",
      runId: "run_research_01",
      sessionId: "ses_research_01",
    },
    audience: { mode: "project" },
    sensitivity: "normal",
    evidenceEventIds: ["evt_research_source"],
    publishedAt: "2026-08-18T01:00:00Z",
    expiresAt: null,
    supersedesSharedContextId: null,
    ...overrides,
  };
}

function handoff(overrides: Partial<HandoffBundle> = {}): HandoffBundle {
  return {
    schemaVersion: 1,
    handoffId: "hnd_research_marketing",
    projectId: "prj_01234567",
    from: {
      roleId: "researcher",
      runId: "run_research_01",
      sessionId: "ses_research_01",
      contextGeneration: 2,
    },
    toRoleId: "marketer",
    requestDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    sharedContextIds: ["scx_research_finding"],
    evidenceEventIds: ["evt_research_source"],
    createdAt: "2026-08-18T01:01:00Z",
    ...overrides,
  };
}

function recipientEvidence(): ContextEvidence[] {
  const coordinates = {
    projectId: "prj_01234567",
    runId: "run_marketing_01",
    sessionId: "ses_marketing_01",
  };
  return [
    {
      ...coordinates,
      receiptId: "ctx_marketing_select",
      documentId: "doc_research_finding",
      state: "selected",
      recordedAt: "2026-08-18T01:02:00Z",
      required: true,
      scope: { kind: "full" },
      policyVersion,
      reasonCode: "handoff",
      ruleId: "handoff:hnd_research_marketing",
    },
    {
      ...coordinates,
      receiptId: "ctx_marketing_loaded",
      documentId: "doc_research_finding",
      state: "loaded",
      recordedAt: "2026-08-18T01:02:01Z",
      scope: { kind: "full" },
      contentHash,
      byteCount: 128,
      sourceRevision: "working-tree:research-v1",
    },
    {
      ...coordinates,
      receiptId: "ctx_marketing_injected",
      documentId: "doc_research_finding",
      state: "injected",
      recordedAt: "2026-08-18T01:02:02Z",
      scope: { kind: "full" },
      contentHash,
      provider: "claude",
      providerSessionId: "provider-marketing-1",
      adapterId: "roven/claude",
      envelopeId: "envelope-marketing-1",
      targetTurnId: "turn-marketing-1",
      contextGeneration: 1,
      controlledInput: true,
    },
  ];
}

describe("shared context and role handoff", () => {
  it("turns an allowed handoff into documents the recipient must read itself", () => {
    const resolution = resolveHandoffContext({
      handoff: handoff(),
      producerRole: researcherRole(),
      publications: [publication()],
      at: new Date("2026-08-18T01:02:00Z"),
    });
    expect(resolution).toEqual({
      allowed: true,
      requiredDocuments: [
        {
          documentId: "doc_research_finding",
          contentHash,
          scope: { kind: "full" },
        },
      ],
      violations: [],
    });
    if (!resolution.allowed) throw new Error("fixture handoff must resolve");

    expect(
      evaluateWriteContext({
        coordinates: {
          projectId: "prj_01234567",
          runId: "run_marketing_01",
          sessionId: "ses_marketing_01",
          contextGeneration: 1,
        },
        requiredDocuments: resolution.requiredDocuments,
        evidence: recipientEvidence(),
      }),
    ).toEqual({ allowed: true, assurance: "E3", missing: [] });
  });

  it("does not let the recipient inherit the producer session receipts", () => {
    const resolution = resolveHandoffContext({
      handoff: handoff(),
      producerRole: researcherRole(),
      publications: [publication()],
      at: new Date("2026-08-18T01:02:00Z"),
    });
    if (!resolution.allowed) throw new Error("fixture handoff must resolve");

    expect(
      evaluateWriteContext({
        coordinates: {
          projectId: "prj_01234567",
          runId: "run_marketing_01",
          sessionId: "ses_marketing_01",
          contextGeneration: 1,
        },
        requiredDocuments: resolution.requiredDocuments,
        evidence: recipientEvidence().map((item) => ({
          ...item,
          runId: "run_research_01",
          sessionId: "ses_research_01",
        })),
      }),
    ).toMatchObject({
      allowed: false,
      missing: [{ reason: "not_selected" }],
    });
  });

  it("blocks a handoff when the recipient role is not allowed", () => {
    expect(
      resolveHandoffContext({
        handoff: handoff(),
        producerRole: researcherRole(["reviewer"]),
        publications: [publication()],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "contract_validation_failed",
      violations: [{ code: "recipient_role_not_allowed" }],
    });
  });

  it("prioritizes a contract violation when freshness also fails", () => {
    expect(
      resolveHandoffContext({
        handoff: handoff({
          from: {
            roleId: "developer",
            runId: "run_research_01",
            sessionId: "ses_research_01",
            contextGeneration: 2,
          },
        }),
        producerRole: researcherRole(),
        publications: [publication({ expiresAt: "2026-08-18T01:01:59Z" })],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "contract_validation_failed",
      violations: [
        { code: "producer_role_mismatch" },
        { code: "context_expired" },
      ],
    });
  });

  it("blocks context that is outside the recipient audience", () => {
    expect(
      resolveHandoffContext({
        handoff: handoff(),
        producerRole: researcherRole(),
        publications: [
          publication({
            audience: { mode: "roles", roleIds: ["reviewer"] },
            sensitivity: "restricted",
          }),
        ],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "contract_validation_failed",
      violations: [{ code: "context_not_readable" }],
    });
  });

  it("requires expired shared context to be refreshed", () => {
    const sharedContext = publication({ expiresAt: "2026-08-18T01:01:59Z" });
    expect(
      decideSharedContextAccess({
        publication: sharedContext,
        roleId: "marketer",
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toEqual({ allowed: false, reason: "expired" });
    expect(
      resolveHandoffContext({
        handoff: handoff(),
        producerRole: researcherRole(),
        publications: [sharedContext],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "required_context_missing",
      violations: [{ code: "context_expired" }],
    });
  });

  it("does not expose a publication before its published time", () => {
    expect(
      decideSharedContextAccess({
        publication: publication({ publishedAt: "2026-08-18T01:03:00Z" }),
        roleId: "marketer",
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toEqual({ allowed: false, reason: "not_yet_published" });
  });

  it("rejects a handoff that still points at a superseded publication", () => {
    const replacement = publication({
      sharedContextId: "scx_research_replacement",
      documentId: "doc_research_replacement",
      publishedAt: "2026-08-18T01:01:30Z",
      supersedesSharedContextId: "scx_research_finding",
    });
    expect(
      resolveHandoffContext({
        handoff: handoff(),
        producerRole: researcherRole(),
        publications: [publication(), replacement],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "required_context_missing",
      violations: [{ code: "context_superseded" }],
    });
  });

  it("does not resolve a context from another project", () => {
    expect(
      resolveHandoffContext({
        handoff: handoff(),
        producerRole: researcherRole(),
        publications: [publication({ projectId: "prj_99999999" })],
        at: new Date("2026-08-18T01:02:00Z"),
      }),
    ).toMatchObject({
      allowed: false,
      failure: "contract_validation_failed",
      violations: [{ code: "context_project_mismatch" }],
    });
  });
});

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  type DocumentRegistry,
  type HandoffBundle,
  type RoleProfile,
  type SharedContextPublication,
  validateSchema,
} from "@roven/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  ContextPreparationError,
  createContextPlan,
  discoverInstructionDocuments,
  documentIdForPath,
  loadContextPlan,
  prepareContext,
  validateContextSnapshot,
} from "../src/index.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function receiptFactory(): () => string {
  let sequence = 0;
  return () => `ctx_receipt_${String(++sequence).padStart(8, "0")}`;
}

async function temporaryDirectory(prefix = "roven-context-"): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function role(
  roleId: string,
  requiredDocumentRuleIds: string[],
  allowedRoleIds: string[] = [],
): RoleProfile {
  return {
    schemaVersion: 1,
    roleId,
    name: roleId,
    description: `${roleId} fixture role`,
    requestTypes: ["fixture"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds,
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "allow",
      "shell.execute": "allow",
      "network.access": "deny",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "fixture_output",
      schemaRef: "roven-schema://fixture/output/v1",
      pathTemplate: ".roven/generated/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: "writing_ko-kr-human",
      },
    },
    verification: {
      suiteIds: ["fixture.default"],
      failureDisposition: "fail_run",
    },
    handoff: {
      allowedRoleIds,
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}

function registry(): DocumentRegistry {
  const record = (path: string, connectedPaths: string[]) => ({
    path,
    kind: "canonical" as const,
    responsibleParty: { kind: "team" as const, id: "team_roven" },
    connectedPaths,
    verifiedRevision: "fixture-revision",
    verifiedAt: "2026-08-18T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" as const },
  });
  return {
    schemaVersion: 1,
    documents: {
      doc_architecture: record("docs/architecture.md", ["packages/api/**"]),
      doc_brand_policy: record("docs/brand.md", ["marketing/**"]),
      doc_research_finding: record(".roven/generated/research/finding.md", [
        "marketing/**",
      ]),
      doc_restricted_finding: record(".roven/generated/research/restricted.md", [
        "research/**",
      ]),
    },
  };
}

interface FixtureRepository {
  root: string;
  registry: DocumentRegistry;
  marketer: RoleProfile;
  researcher: RoleProfile;
  publications: SharedContextPublication[];
  handoff: HandoffBundle;
  researchContent: string;
}

async function fixtureRepository(): Promise<FixtureRepository> {
  const root = await temporaryDirectory();
  await Promise.all([
    mkdir(resolve(root, "packages/api"), { recursive: true }),
    mkdir(resolve(root, "packages/other"), { recursive: true }),
    mkdir(resolve(root, "docs"), { recursive: true }),
    mkdir(resolve(root, ".roven/generated/research"), { recursive: true }),
  ]);
  const researchContent = "사용자 인터뷰에서 반복된 문제와 근거입니다.\n";
  await Promise.all([
    writeFile(resolve(root, "AGENTS.md"), "프로젝트 전체 지침입니다.\n"),
    writeFile(resolve(root, "packages/AGENTS.md"), "패키지 공통 지침입니다.\n"),
    writeFile(resolve(root, "packages/api/AGENTS.md"), "API 변경 지침입니다.\n"),
    writeFile(resolve(root, "packages/other/AGENTS.md"), "다른 패키지 지침입니다.\n"),
    writeFile(resolve(root, "docs/architecture.md"), "API 아키텍처 원칙입니다.\n"),
    writeFile(resolve(root, "docs/brand.md"), "브랜드 표현 원칙입니다.\n"),
    writeFile(resolve(root, ".roven/generated/research/finding.md"), researchContent),
    writeFile(
      resolve(root, ".roven/generated/research/restricted.md"),
      "연구자만 읽을 수 있는 제한 자료입니다.\n",
    ),
  ]);
  const researcher = role("researcher", ["repository.instructions"], ["marketer"]);
  const marketer = role("marketer", [
    "repository.instructions",
    "path.instructions",
    "brand.policy",
  ]);
  const publications: SharedContextPublication[] = [
    {
      schemaVersion: 1,
      sharedContextId: "scx_research_finding",
      projectId,
      kind: "finding",
      documentId: "doc_research_finding",
      contentHash: hash(researchContent),
      sourceRevision: "fixture-research-v1",
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
    },
    {
      schemaVersion: 1,
      sharedContextId: "scx_restricted_finding",
      projectId,
      kind: "finding",
      documentId: "doc_restricted_finding",
      contentHash: hash("연구자만 읽을 수 있는 제한 자료입니다.\n"),
      sourceRevision: "fixture-restricted-v1",
      producer: {
        kind: "agent",
        roleId: "researcher",
        runId: "run_research_01",
        sessionId: "ses_research_01",
      },
      audience: { mode: "roles", roleIds: ["researcher"] },
      sensitivity: "restricted",
      evidenceEventIds: ["evt_research_private"],
      publishedAt: "2026-08-18T01:00:00Z",
      expiresAt: null,
      supersedesSharedContextId: null,
    },
  ];
  const handoff: HandoffBundle = {
    schemaVersion: 1,
    handoffId: "hnd_research_marketing",
    projectId,
    from: {
      roleId: "researcher",
      runId: "run_research_01",
      sessionId: "ses_research_01",
      contextGeneration: 2,
    },
    toRoleId: "marketer",
    requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    sharedContextIds: ["scx_research_finding"],
    evidenceEventIds: ["evt_research_source"],
    createdAt: "2026-08-18T01:01:00Z",
  };
  return { root, registry: registry(), marketer, researcher, publications, handoff, researchContent };
}

function planInput(fixture: FixtureRepository, createReceiptId = receiptFactory()) {
  return {
    coordinates: {
      projectId,
      runId: "run_marketing_01",
      sessionId: "ses_marketing_01",
      roleId: "marketer",
    },
    registry: fixture.registry,
    role: fixture.marketer,
    expectedPaths: ["packages/api/src/handler.ts"],
    documentRules: { "brand.policy": ["doc_brand_policy"] },
    publications: fixture.publications,
    handoffs: [{ bundle: fixture.handoff, producerRole: fixture.researcher }],
    policyVersion,
    recordedAt: new Date("2026-08-18T01:02:00Z"),
    createReceiptId,
  } as const;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("context preparation", () => {
  it("selects hierarchy, path, role, and handoff documents before loading bytes", async () => {
    const fixture = await fixtureRepository();
    expect(validateSchema("documentRegistry", fixture.registry)).toEqual({
      valid: true,
      errors: [],
    });
    const ids = receiptFactory();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    expect(instructions.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "packages/AGENTS.md",
      "packages/api/AGENTS.md",
    ]);
    expect(instructions.map((document) => document.path)).not.toContain(
      "packages/other/AGENTS.md",
    );

    const plan = createContextPlan({
      ...planInput(fixture, ids),
      instructionDocuments: instructions,
    });
    expect(plan.documents.map((document) => document.path)).toEqual([
      ".roven/generated/research/finding.md",
      "AGENTS.md",
      "docs/architecture.md",
      "docs/brand.md",
      "packages/AGENTS.md",
      "packages/api/AGENTS.md",
    ]);
    expect(new Set(plan.evidence.map((item) => item.state))).toEqual(
      new Set(["discovered", "selected"]),
    );
    expect(plan.evidence).not.toContainEqual(expect.objectContaining({ state: "loaded" }));
    expect(plan.evidence).not.toContainEqual(expect.objectContaining({ state: "injected" }));
    expect(
      plan.evidence.filter(
        (item) => item.documentId === "doc_research_finding" && item.state === "selected",
      ),
    ).toContainEqual(
      expect.objectContaining({
        reasonCode: "handoff",
        ruleId: "handoff:hnd_research_marketing",
      }),
    );
    expect(plan.evidence.every((item) => item.runId === "run_marketing_01")).toBe(true);
    expect(plan.evidence.every((item) => item.sessionId === "ses_marketing_01")).toBe(true);

    const loaded = await loadContextPlan({
      repositoryRoot: fixture.root,
      plan,
      sourceRevision: "working-tree:fixture-1",
      recordedAt: new Date("2026-08-18T01:02:01Z"),
      createReceiptId: ids,
    });
    expect(loaded.documents).toHaveLength(6);
    expect(loaded.evidence.filter((item) => item.state === "loaded")).toHaveLength(6);
    expect(loaded.evidence).not.toContainEqual(expect.objectContaining({ state: "injected" }));
    for (const document of loaded.documents) {
      expect(document.byteCount).toBe(document.bytes.byteLength);
      expect(document.contentHash).toBe(
        `sha256:${createHash("sha256").update(document.bytes).digest("hex")}`,
      );
    }
  });

  it("discovers readable shared context without claiming it was selected", async () => {
    const fixture = await fixtureRepository();
    const ids = receiptFactory();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    const plan = createContextPlan({
      ...planInput(fixture, ids),
      instructionDocuments: instructions,
      handoffs: [],
    });

    expect(plan.evidence).toContainEqual(
      expect.objectContaining({
        documentId: "doc_research_finding",
        state: "discovered",
      }),
    );
    expect(plan.evidence).not.toContainEqual(
      expect.objectContaining({
        documentId: "doc_research_finding",
        state: "selected",
      }),
    );
    expect(plan.evidence).not.toContainEqual(
      expect.objectContaining({ documentId: "doc_restricted_finding" }),
    );
  });

  it("reads user documents without changing their bytes or modification time", async () => {
    const fixture = await fixtureRepository();
    const path = resolve(fixture.root, "docs/brand.md");
    const beforeBytes = await readFile(path);
    const beforeStat = await stat(path, { bigint: true });

    await prepareContext({
      repositoryRoot: fixture.root,
      sourceRevision: "working-tree:fixture-1",
      ...planInput(fixture),
    });

    expect(await readFile(path)).toEqual(beforeBytes);
    expect((await stat(path, { bigint: true })).mtimeNs).toBe(beforeStat.mtimeNs);
  });

  it("hashes bytes at load time instead of treating selection as a read", async () => {
    const fixture = await fixtureRepository();
    const ids = receiptFactory();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    const plan = createContextPlan({
      ...planInput(fixture, ids),
      instructionDocuments: instructions,
      handoffs: [],
    });
    const changed = "선택 이후, 실제 읽기 전에 바뀐 브랜드 원칙입니다.\n";
    await writeFile(resolve(fixture.root, "docs/brand.md"), changed);

    const loaded = await loadContextPlan({
      repositoryRoot: fixture.root,
      plan,
      sourceRevision: "working-tree:fixture-2",
      recordedAt: new Date("2026-08-18T01:02:01Z"),
      createReceiptId: ids,
    });
    expect(
      loaded.documents.find((document) => document.documentId === "doc_brand_policy"),
    ).toMatchObject({
      contentHash: hash(changed),
      byteCount: Buffer.byteLength(changed),
    });
  });

  it("rejects a plan that inherits selection evidence from another run", async () => {
    const fixture = await fixtureRepository();
    const ids = receiptFactory();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    const plan = createContextPlan({
      ...planInput(fixture, ids),
      instructionDocuments: instructions,
    });
    const producerEvidence = plan.evidence.map((item) => ({
      ...item,
      runId: "run_research_01",
      sessionId: "ses_research_01",
    }));

    await expect(
      loadContextPlan({
        repositoryRoot: fixture.root,
        plan: { ...plan, evidence: producerEvidence },
        sourceRevision: "working-tree:fixture-1",
        recordedAt: new Date("2026-08-18T01:02:01Z"),
        createReceiptId: ids,
      }),
    ).rejects.toMatchObject({ code: "invalid_context_plan" });
  });

  it("rejects a handoff when its document bytes no longer match the publication", async () => {
    const fixture = await fixtureRepository();
    const ids = receiptFactory();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    const plan = createContextPlan({
      ...planInput(fixture, ids),
      instructionDocuments: instructions,
    });
    await writeFile(
      resolve(fixture.root, ".roven/generated/research/finding.md"),
      "publication 이후 바뀐 조사 결과입니다.\n",
    );

    await expect(
      loadContextPlan({
        repositoryRoot: fixture.root,
        plan,
        sourceRevision: "working-tree:fixture-2",
        recordedAt: new Date("2026-08-18T01:02:01Z"),
        createReceiptId: ids,
      }),
    ).rejects.toMatchObject({ code: "content_hash_mismatch" });
  });

  it("invalidates a loaded snapshot after file content changes", async () => {
    const fixture = await fixtureRepository();
    const loaded = await prepareContext({
      repositoryRoot: fixture.root,
      sourceRevision: "working-tree:fixture-1",
      ...planInput(fixture),
    });
    await writeFile(resolve(fixture.root, "docs/brand.md"), "새 브랜드 원칙입니다.\n");

    await expect(
      validateContextSnapshot({
        repositoryRoot: fixture.root,
        loaded,
        publications: fixture.publications,
        at: new Date("2026-08-18T01:03:00Z"),
      }),
    ).resolves.toMatchObject({
      valid: false,
      invalidations: [
        expect.objectContaining({
          documentId: "doc_brand_policy",
          reason: "content_changed",
        }),
      ],
    });
  });

  it("invalidates a handoff when its publication expires or is superseded", async () => {
    const fixture = await fixtureRepository();
    const expiring = {
      ...fixture.publications[0]!,
      expiresAt: "2026-08-18T01:03:00Z",
    } satisfies SharedContextPublication;
    const loaded = await prepareContext({
      repositoryRoot: fixture.root,
      sourceRevision: "working-tree:fixture-1",
      ...planInput({ ...fixture, publications: [expiring, fixture.publications[1]!] }),
      publications: [expiring, fixture.publications[1]!],
    });
    const replacement = {
      ...expiring,
      sharedContextId: "scx_research_replacement",
      publishedAt: "2026-08-18T01:02:30Z",
      expiresAt: null,
      supersedesSharedContextId: "scx_research_finding",
    } satisfies SharedContextPublication;

    await expect(
      validateContextSnapshot({
        repositoryRoot: fixture.root,
        loaded,
        publications: [expiring, fixture.publications[1]!, replacement],
        at: new Date("2026-08-18T01:03:00Z"),
      }),
    ).resolves.toMatchObject({
      valid: false,
      invalidations: [
        expect.objectContaining({
          sharedContextId: "scx_research_finding",
          reason: "publication_superseded",
        }),
      ],
    });
  });

  it("invalidates a handoff when the recipient loses publication access", async () => {
    const fixture = await fixtureRepository();
    const loaded = await prepareContext({
      repositoryRoot: fixture.root,
      sourceRevision: "working-tree:fixture-1",
      ...planInput(fixture),
    });
    const revoked = {
      ...fixture.publications[0]!,
      audience: { mode: "roles", roleIds: ["researcher"] },
      sensitivity: "restricted",
    } satisfies SharedContextPublication;

    await expect(
      validateContextSnapshot({
        repositoryRoot: fixture.root,
        loaded,
        publications: [revoked, fixture.publications[1]!],
        at: new Date("2026-08-18T01:03:00Z"),
      }),
    ).resolves.toMatchObject({
      valid: false,
      invalidations: [
        expect.objectContaining({
          sharedContextId: "scx_research_finding",
          reason: "publication_access_revoked",
        }),
      ],
    });
  });

  it("keeps every shared context id when two publications point to one document", async () => {
    const fixture = await fixtureRepository();
    const second = {
      ...fixture.publications[0]!,
      sharedContextId: "scx_research_summary",
      kind: "artifact_summary",
    } satisfies SharedContextPublication;
    const handoffWithTwoContexts = {
      ...fixture.handoff,
      sharedContextIds: ["scx_research_finding", "scx_research_summary"],
    } satisfies HandoffBundle;
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    const plan = createContextPlan({
      ...planInput({
        ...fixture,
        publications: [fixture.publications[0]!, fixture.publications[1]!, second],
        handoff: handoffWithTwoContexts,
      }),
      instructionDocuments: instructions,
    });

    expect(
      plan.documents.find((document) => document.documentId === "doc_research_finding"),
    ).toMatchObject({
      sharedContextIds: ["scx_research_finding", "scx_research_summary"],
    });
  });

  it("rejects symbolic-link parents before reading outside the repository", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory("roven-context-outside-");
    await writeFile(resolve(root, "AGENTS.md"), "프로젝트 지침입니다.\n");
    await writeFile(resolve(outside, "secret.md"), "저장소 밖 원문입니다.\n");
    await symlink(outside, resolve(root, "docs"));
    const documentRegistry: DocumentRegistry = {
      schemaVersion: 1,
      documents: {
        doc_secret_context: {
          path: "docs/secret.md",
          kind: "canonical",
          responsibleParty: { kind: "user", id: "owner" },
          connectedPaths: ["src/**"],
          verifiedRevision: "fixture",
          verifiedAt: "2026-08-18T00:00:00Z",
          reviewIntervalDays: 30,
          ownership: { mode: "user" },
        },
      },
    };

    await expect(
      prepareContext({
        repositoryRoot: root,
        sourceRevision: "working-tree:fixture-1",
        coordinates: {
          projectId,
          runId: "run_symlink_01",
          sessionId: "ses_symlink_01",
          roleId: "reviewer",
        },
        registry: documentRegistry,
        role: role("reviewer", ["repository.instructions", "secret.rule"]),
        expectedPaths: ["src/index.ts"],
        documentRules: { "secret.rule": ["doc_secret_context"] },
        publications: [],
        handoffs: [],
        policyVersion,
        recordedAt: new Date("2026-08-18T01:02:00Z"),
        createReceiptId: receiptFactory(),
      }),
    ).rejects.toMatchObject({ code: "unsafe_document_path" });
    expect(await readFile(resolve(outside, "secret.md"), "utf8")).toBe(
      "저장소 밖 원문입니다.\n",
    );
  });

  it("rejects unresolved role rules and a handoff for another recipient", async () => {
    const fixture = await fixtureRepository();
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    expect(() =>
      createContextPlan({
        ...planInput(fixture),
        instructionDocuments: instructions,
        documentRules: {},
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextPreparationError>>({
        code: "required_rule_unresolved",
      }),
    );
    expect(() =>
      createContextPlan({
        ...planInput(fixture),
        instructionDocuments: instructions,
        handoffs: [
          {
            bundle: { ...fixture.handoff, toRoleId: "reviewer" },
            producerRole: fixture.researcher,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextPreparationError>>({
        code: "handoff_recipient_mismatch",
      }),
    );
  });

  it("rejects traversal paths, duplicate registry paths, and invalid receipts", async () => {
    const fixture = await fixtureRepository();
    await expect(
      discoverInstructionDocuments({
        repositoryRoot: fixture.root,
        registry: fixture.registry,
        expectedPaths: ["../outside.ts"],
      }),
    ).rejects.toMatchObject({ code: "invalid_expected_path" });

    const duplicateRegistry: DocumentRegistry = {
      ...fixture.registry,
      documents: {
        ...fixture.registry.documents,
        doc_architecture_copy: fixture.registry.documents.doc_architecture!,
      },
    };
    expect(() =>
      createContextPlan({
        ...planInput({ ...fixture, registry: duplicateRegistry }),
        registry: duplicateRegistry,
        instructionDocuments: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextPreparationError>>({
        code: "duplicate_document_path",
      }),
    );

    const instructions = await discoverInstructionDocuments({
      repositoryRoot: fixture.root,
      registry: fixture.registry,
      expectedPaths: ["packages/api/src/handler.ts"],
    });
    expect(() =>
      createContextPlan({
        ...planInput(fixture),
        instructionDocuments: instructions,
        policyVersion: "not-a-sha256",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextPreparationError>>({
        code: "invalid_context_evidence",
      }),
    );

    expect(() =>
      createContextPlan({
        ...planInput(fixture),
        instructionDocuments: instructions,
        publications: [fixture.publications[0]!, fixture.publications[0]!],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextPreparationError>>({
        code: "duplicate_shared_context_id",
      }),
    );
  });

  it("derives the same opaque document id from the same unregistered path", () => {
    expect(documentIdForPath("packages/api/AGENTS.md")).toBe(
      documentIdForPath("packages\\api\\AGENTS.md"),
    );
    expect(documentIdForPath("packages/api/AGENTS.md")).toMatch(/^doc_path_[a-f0-9]{24}$/);
  });
});

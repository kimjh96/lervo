import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DeliberationTurnResult } from "@lervo/deliberation-runtime";
import type {
  DocumentRecord,
  DocumentRegistry,
  HandoffBundle,
  RoleProfile,
  SharedContextPublication,
  WritingContract,
} from "@lervo/schemas";

import {
  deliberationContentHash,
  materializeDeliberationDocument,
  repositoryRelativePath,
} from "./deliberation-document-materializer.js";
import {
  assertManagedDeliberationEvidenceBundle,
  type ManagedDeliberationEvidenceBundle,
} from "./managed-deliberation-evidence.js";

export interface PublishedContext {
  publication: SharedContextPublication;
  handoff: HandoffBundle;
  producerRole: RoleProfile;
}

export interface DeliberationWorkspaceSnapshot {
  schemaVersion: 1;
  createdAt: string;
  participantRoleIds: string[];
  writingPolicyDocumentId: string;
  writingPolicyContentHash: string;
  generatedDocuments: Record<string, DocumentRecord>;
  contexts: PublishedContext[];
  taskEvidenceDocumentIds?: string[];
  taskEvidenceBundleHash?: string | null;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class DeliberationWorkspace {
  private readonly documents: Record<string, DocumentRecord>;
  private readonly contexts: PublishedContext[] = [];
  private readonly publicationsById = new Map<string, SharedContextPublication>();
  private readonly generatedDocumentIds = new Set<string>();
  private taskEvidenceIds: string[] = [];
  private taskEvidenceHash: string | null = null;

  private constructor(
    private readonly repositoryRoot: string,
    private readonly deliberationRoot: string,
    private readonly createdAt: string,
    private readonly participantRoleIds: readonly string[],
    registry: DocumentRegistry,
    readonly writingPolicyDocumentId: string,
    readonly writingPolicyContentHash: string,
    readonly writingContract: WritingContract,
  ) {
    this.documents = structuredClone(registry.documents);
  }

  static async create(input: {
    repositoryRoot: string;
    stateRoot: string;
    deliberationId: string;
    registry: DocumentRegistry;
    createdAt: string;
    participantRoleIds: readonly string[];
    writingContract: WritingContract;
  }): Promise<DeliberationWorkspace> {
    const parent = resolve(input.stateRoot, "deliberations");
    const root = resolve(parent, input.deliberationId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await mkdir(root, { mode: 0o700 });
    const writingBytes = `${JSON.stringify(input.writingContract, null, 2)}\n`;
    const writingPolicyDocumentId = `doc_writing_${shortHash(input.deliberationId)}`;
    const workspace = new DeliberationWorkspace(
      input.repositoryRoot,
      root,
      input.createdAt,
      [...input.participantRoleIds],
      input.registry,
      writingPolicyDocumentId,
      deliberationContentHash(writingBytes),
      structuredClone(input.writingContract),
    );
    workspace.documents[writingPolicyDocumentId] = await workspace.materializeDocument({
      documentId: writingPolicyDocumentId,
      directoryName: "writing-policy",
      filename: "content.json",
      content: writingBytes,
      sourceId: `writing-contract:${input.writingContract.writingPolicyId}`,
    });
    return workspace;
  }

  static async resume(input: {
    repositoryRoot: string;
    stateRoot: string;
    deliberationId: string;
    registry: DocumentRegistry;
    participantRoleIds: readonly string[];
    snapshot: DeliberationWorkspaceSnapshot;
    writingContract: WritingContract;
  }): Promise<DeliberationWorkspace> {
    const root = resolve(input.stateRoot, "deliberations", input.deliberationId);
    const stats = await lstat(root);
    if (
      input.snapshot.schemaVersion !== 1 ||
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      JSON.stringify(input.participantRoleIds) !== JSON.stringify(input.snapshot.participantRoleIds)
    ) {
      throw new Error("The deliberation workspace snapshot directory or participant roles differ.");
    }
    const workspace = new DeliberationWorkspace(
      input.repositoryRoot,
      root,
      input.snapshot.createdAt,
      [...input.participantRoleIds],
      input.registry,
      input.snapshot.writingPolicyDocumentId,
      input.snapshot.writingPolicyContentHash,
      structuredClone(input.writingContract),
    );
    const expectedPrefix = `${repositoryRelativePath(input.repositoryRoot, root)}/`;
    for (const [documentId, record] of Object.entries(input.snapshot.generatedDocuments)) {
      const path = resolve(input.repositoryRoot, record.path);
      const relativePath = repositoryRelativePath(input.repositoryRoot, path);
      const file = await lstat(path);
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        relativePath !== record.path ||
        !relativePath.startsWith(expectedPrefix) ||
        record.kind !== "generated" ||
        record.ownership.mode !== "lervo_generated"
      ) {
        throw new Error("A generated document path in the deliberation workspace is unsafe.");
      }
      const bytes = await readFile(path);
      if (deliberationContentHash(bytes) !== record.verifiedRevision) {
        throw new Error(
          "Generated document bytes in the deliberation workspace differ from the snapshot.",
        );
      }
      workspace.documents[documentId] = structuredClone(record);
      workspace.generatedDocumentIds.add(documentId);
    }
    const writingRecord = workspace.documents[input.snapshot.writingPolicyDocumentId];
    if (
      writingRecord === undefined ||
      writingRecord.verifiedRevision !== input.snapshot.writingPolicyContentHash ||
      deliberationContentHash(`${JSON.stringify(input.writingContract, null, 2)}\n`) !==
        input.snapshot.writingPolicyContentHash
    )
      throw new Error(
        "The writing contract in the deliberation workspace differs from the snapshot.",
      );
    for (const context of input.snapshot.contexts) workspace.rememberContext(context);
    const taskEvidenceIds = input.snapshot.taskEvidenceDocumentIds ?? [];
    if (
      new Set(taskEvidenceIds).size !== taskEvidenceIds.length ||
      taskEvidenceIds.some((documentId) => !workspace.generatedDocumentIds.has(documentId))
    ) {
      throw new Error("Task evidence in the deliberation workspace snapshot is invalid.");
    }
    workspace.taskEvidenceIds = [...taskEvidenceIds];
    workspace.taskEvidenceHash = input.snapshot.taskEvidenceBundleHash ?? null;
    return workspace;
  }

  snapshot(): DeliberationWorkspaceSnapshot {
    return {
      schemaVersion: 1,
      createdAt: this.createdAt,
      participantRoleIds: [...this.participantRoleIds],
      writingPolicyDocumentId: this.writingPolicyDocumentId,
      writingPolicyContentHash: this.writingPolicyContentHash,
      generatedDocuments: Object.fromEntries(
        [...this.generatedDocumentIds].map((documentId) => [
          documentId,
          structuredClone(this.documents[documentId]!),
        ]),
      ),
      contexts: structuredClone(this.contexts),
      taskEvidenceDocumentIds: [...this.taskEvidenceIds],
      taskEvidenceBundleHash: this.taskEvidenceHash,
    };
  }

  registry(): DocumentRegistry {
    return { schemaVersion: 1, documents: structuredClone(this.documents) };
  }

  publications(): SharedContextPublication[] {
    return [...this.publicationsById.values()].map((item) => structuredClone(item));
  }

  handoffsFor(roleId: string): Array<{ bundle: HandoffBundle; producerRole: RoleProfile }> {
    return this.contexts
      .filter((item) => item.handoff.toRoleId === roleId)
      .map((item) => ({
        bundle: structuredClone(item.handoff),
        producerRole: structuredClone(item.producerRole),
      }));
  }

  taskEvidenceDocumentIds(): string[] {
    return [...this.taskEvidenceIds];
  }

  taskEvidenceBundleHash(): string | null {
    return this.taskEvidenceHash;
  }

  async installTaskEvidence(bundle: ManagedDeliberationEvidenceBundle): Promise<void> {
    assertManagedDeliberationEvidenceBundle(bundle);
    if (this.taskEvidenceIds.length > 0 || this.taskEvidenceHash !== null) {
      throw new Error("Task evidence is already installed in the deliberation workspace.");
    }
    const token = bundle.bundleHash.slice("sha256:".length, "sha256:".length + 16);
    const manifestId = `doc_evidence_${token}_manifest`;
    const manifest = `${JSON.stringify(
      {
        schemaVersion: 1,
        query: bundle.query,
        sourceSnapshotId: bundle.sourceSnapshotId,
        impactReportId: bundle.impactReportId,
        bundleHash: bundle.bundleHash,
        documents: bundle.documents.map(
          ({ conceptId, title, sourcePath, sourceContentHash, assurance, freshness }) => ({
            conceptId,
            title,
            sourcePath,
            sourceContentHash,
            assurance,
            freshness,
          }),
        ),
      },
      null,
      2,
    )}\n`;
    this.documents[manifestId] = await this.materializeDocument({
      documentId: manifestId,
      directoryName: `evidence-${token}-manifest`,
      filename: "content.json",
      content: manifest,
      sourceId: `deliberation-evidence:${bundle.bundleHash}`,
    });
    const documentIds = await Promise.all(
      bundle.documents.map(async (document, index) => {
        const documentId = `doc_evidence_${token}_${String(index + 1).padStart(2, "0")}`;
        this.documents[documentId] = await this.materializeDocument({
          documentId,
          directoryName: `evidence-${token}-${String(index + 1).padStart(2, "0")}`,
          filename: "content.md",
          content: document.content,
          sourceId: `${document.conceptId}:${document.sourcePath}:${document.sourceContentHash}`,
        });
        return documentId;
      }),
    );
    this.taskEvidenceIds = [manifestId, ...documentIds];
    this.taskEvidenceHash = bundle.bundleHash;
  }

  rememberContext(input: {
    publication: SharedContextPublication;
    handoff: HandoffBundle;
    producerRole: RoleProfile;
  }): void {
    const existing = this.publicationsById.get(input.publication.sharedContextId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(input.publication)) {
      throw new Error("Different deliberation sources cannot share one shared context ID.");
    }
    this.publicationsById.set(
      input.publication.sharedContextId,
      structuredClone(input.publication),
    );
    this.contexts.push(structuredClone(input));
  }

  async materializeTurn(input: {
    turn: DeliberationTurnResult;
    producerRole: RoleProfile;
  }): Promise<{
    publication: SharedContextPublication;
    handoffFor: (roleId: string) => HandoffBundle;
  }> {
    const artifact = input.turn.artifact;
    if (deliberationContentHash(input.turn.content) !== artifact.content.contentHash) {
      throw new Error("The deliberation artifact bytes do not match the recorded content hash.");
    }
    const suffix = artifact.deliberationArtifactId.slice(4);
    const documentId = `doc_${suffix}`;
    this.documents[documentId] = await this.materializeDocument({
      documentId,
      directoryName: `artifact-${suffix}`,
      filename: "content.md",
      content: input.turn.content,
      sourceId: artifact.deliberationArtifactId,
    });
    const publication: SharedContextPublication = {
      schemaVersion: 1,
      sharedContextId: `scx_${suffix}`,
      projectId: artifact.projectId,
      kind: artifact.kind === "verification" ? "verification_result" : "artifact_summary",
      documentId,
      contentHash: artifact.content.contentHash,
      sourceRevision: `artifact:${artifact.deliberationArtifactId}`,
      producer: {
        kind: "agent",
        roleId: artifact.producer.roleId,
        runId: artifact.producer.runId,
        sessionId: artifact.producer.sessionId,
      },
      audience: {
        mode: "roles",
        roleIds: [...this.participantRoleIds],
      },
      sensitivity: "normal",
      evidenceEventIds: [input.turn.recordedEvent.eventId],
      publishedAt: artifact.createdAt,
      expiresAt: null,
      supersedesSharedContextId: null,
    };
    return {
      publication,
      handoffFor: (roleId) => ({
        schemaVersion: 1,
        handoffId: `hnd_${suffix}_${shortHash(roleId)}`,
        projectId: artifact.projectId,
        from: {
          roleId: artifact.producer.roleId,
          runId: artifact.producer.runId,
          sessionId: artifact.producer.sessionId,
          contextGeneration: artifact.inputContext.contextGeneration,
        },
        toRoleId: roleId,
        requestDigest: deliberationContentHash(
          `${artifact.deliberationArtifactId}:${roleId}:${publication.sharedContextId}`,
        ),
        sharedContextIds: [publication.sharedContextId],
        evidenceEventIds: [input.turn.recordedEvent.eventId],
        createdAt: artifact.createdAt,
      }),
    };
  }

  async materializeSemanticEvaluationRequest(content: string): Promise<string> {
    const token = randomUUID().replaceAll("-", "");
    const documentId = `doc_eval_${token.slice(0, 16)}`;
    this.documents[documentId] = await this.materializeDocument({
      documentId,
      directoryName: `evaluation-${token.slice(0, 16)}`,
      filename: "request.json",
      content,
      sourceId: `writing-evaluation:${deliberationContentHash(content)}`,
    });
    return documentId;
  }

  private async materializeDocument(input: {
    documentId: string;
    directoryName: string;
    filename: string;
    content: string;
    sourceId: string;
  }): Promise<DocumentRecord> {
    const record = await materializeDeliberationDocument({
      repositoryRoot: this.repositoryRoot,
      deliberationRoot: this.deliberationRoot,
      createdAt: this.createdAt,
      ...input,
    });
    this.generatedDocumentIds.add(input.documentId);
    return record;
  }
}

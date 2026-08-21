import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { defaultKoreanWritingContract } from "@lervo/core";
import type { DeliberationTurnResult } from "@lervo/deliberation-runtime";
import type {
  DocumentRecord,
  DocumentRegistry,
  HandoffBundle,
  RoleProfile,
  SharedContextPublication,
} from "@lervo/schemas";

interface PublishedContext {
  publication: SharedContextPublication;
  handoff: HandoffBundle;
  producerRole: RoleProfile;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function repositoryPath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (value.length === 0 || value.startsWith("../") || value === "..") {
    throw new Error("숙의 runtime 문서 경로가 저장소 밖을 가리킵니다.");
  }
  return value;
}

export class DeliberationWorkspace {
  private readonly documents: Record<string, DocumentRecord>;
  private readonly contexts: PublishedContext[] = [];
  private readonly publicationsById = new Map<string, SharedContextPublication>();

  private constructor(
    private readonly repositoryRoot: string,
    private readonly deliberationRoot: string,
    private readonly createdAt: string,
    private readonly participantRoleIds: readonly string[],
    registry: DocumentRegistry,
    readonly writingPolicyDocumentId: string,
    readonly writingPolicyContentHash: string,
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
  }): Promise<DeliberationWorkspace> {
    const parent = resolve(input.stateRoot, "deliberations");
    const root = resolve(parent, input.deliberationId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await mkdir(root, { mode: 0o700 });
    const writingBytes = `${JSON.stringify(defaultKoreanWritingContract, null, 2)}\n`;
    const writingPolicyDocumentId = `doc_writing_${shortHash(input.deliberationId)}`;
    const workspace = new DeliberationWorkspace(
      input.repositoryRoot,
      root,
      input.createdAt,
      [...input.participantRoleIds],
      input.registry,
      writingPolicyDocumentId,
      sha256(writingBytes),
    );
    workspace.documents[writingPolicyDocumentId] = await workspace.materializeDocument({
      documentId: writingPolicyDocumentId,
      directoryName: "writing-policy",
      filename: "content.json",
      content: writingBytes,
      sourceId: `writing-contract:${defaultKoreanWritingContract.writingPolicyId}`,
    });
    return workspace;
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

  rememberContext(input: {
    publication: SharedContextPublication;
    handoff: HandoffBundle;
    producerRole: RoleProfile;
  }): void {
    const existing = this.publicationsById.get(input.publication.sharedContextId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(input.publication)) {
      throw new Error("같은 shared context ID에 서로 다른 숙의 원본을 연결할 수 없습니다.");
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
    if (sha256(input.turn.content) !== artifact.content.contentHash) {
      throw new Error("숙의 artifact 원문이 기록된 content hash와 다릅니다.");
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
        requestDigest: sha256(
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
      sourceId: `writing-evaluation:${sha256(content)}`,
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
    const temporary = await mkdtemp(resolve(this.deliberationRoot, ".document-"));
    const finalDirectory = resolve(this.deliberationRoot, input.directoryName);
    const contentPath = resolve(temporary, input.filename);
    const digest = sha256(input.content);
    const manifest = {
      schemaVersion: 1,
      documentId: input.documentId,
      contentHash: digest,
      sourceId: input.sourceId,
    };
    try {
      await Promise.all([
        writeFile(contentPath, input.content, { flag: "wx", mode: 0o600 }),
        writeFile(
          resolve(temporary, "manifest.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        ),
      ]);
      await rename(temporary, finalDirectory);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const finalContentPath = resolve(finalDirectory, input.filename);
    const manifestPath = resolve(finalDirectory, "manifest.json");
    return {
      path: repositoryPath(this.repositoryRoot, finalContentPath),
      kind: "generated",
      responsibleParty: { kind: "lervo", id: "lervo-deliberation-runtime" },
      connectedPaths: [repositoryPath(this.repositoryRoot, finalContentPath)],
      verifiedRevision: digest,
      verifiedAt: this.createdAt,
      reviewIntervalDays: 1,
      ownership: {
        mode: "lervo_generated",
        userContentAllowed: false,
        manifestPath: repositoryPath(this.repositoryRoot, manifestPath),
        inputs: [{ sourceId: input.sourceId, contentHash: digest }],
      },
    };
  }
}

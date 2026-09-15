import {
  RepositoryKnowledgeQueryIndex,
  type KnowledgeQueryResult,
} from "@lervo/repository-knowledge";
import type { DocumentRegistry } from "@lervo/schemas";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { productDefaultRepositoryKnowledgeRanker } from "./repository-knowledge-ranker.js";

interface PreparedRevision {
  key: string;
  index: RepositoryKnowledgeQueryIndex;
}

interface PendingRevision {
  generation: number;
  key: string;
  index: Promise<RepositoryKnowledgeQueryIndex>;
}

export interface RevisionedRepositoryKnowledgeQueryOptions {
  loadIndex?(repositoryRoot: string): Promise<RepositoryKnowledgeQueryIndex>;
}

function revisionKey(repositoryRoot: string, sourceRevision: string): string {
  return JSON.stringify([repositoryRoot, sourceRevision]);
}

export class RevisionedRepositoryKnowledgeQuery {
  private prepared: PreparedRevision | undefined;
  private pending: PendingRevision | undefined;
  private generation = 0;

  constructor(private readonly options: RevisionedRepositoryKnowledgeQueryOptions = {}) {}

  async prepare(input: { repositoryRoot: string; sourceRevision: string }): Promise<void> {
    await this.resolveIndex(input);
  }

  async query(input: {
    repositoryRoot: string;
    sourceRevision: string;
    query: string;
    limit: number;
    documentRegistry?: DocumentRegistry;
  }): Promise<KnowledgeQueryResult> {
    const index = await this.resolveIndex(input);
    return index.query({
      query: input.query,
      limit: input.limit,
      ...(input.documentRegistry === undefined ? {} : { documentRegistry: input.documentRegistry }),
    });
  }

  private async resolveIndex(input: {
    repositoryRoot: string;
    sourceRevision: string;
  }): Promise<RepositoryKnowledgeQueryIndex> {
    const key = revisionKey(input.repositoryRoot, input.sourceRevision);
    if (this.prepared?.key === key) return this.prepared.index;
    if (this.pending?.key === key) return this.pending.index;

    const generation = ++this.generation;
    const index =
      this.options.loadIndex?.(input.repositoryRoot) ??
      collectLocalKnowledgeSources(input.repositoryRoot).then((supplementalSources) =>
        RepositoryKnowledgeQueryIndex.prepare({
          repositoryRoot: input.repositoryRoot,
          supplementalSources,
          sourceUnitFailureMode: "file_only",
          ranker: productDefaultRepositoryKnowledgeRanker,
        }),
      );
    this.pending = { generation, key, index };
    try {
      const prepared = await index;
      if (this.generation === generation) this.prepared = { key, index: prepared };
      return prepared;
    } finally {
      if (this.pending?.generation === generation) this.pending = undefined;
    }
  }
}

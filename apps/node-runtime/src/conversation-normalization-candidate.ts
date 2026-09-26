import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compileConfiguredDocumentNormalizationCandidateObserved,
  createDocumentNormalizationPlan,
  inspectConfiguredDocumentNormalization,
  loadDocumentNormalizationCandidate,
  storeDocumentNormalizationCandidate,
} from "@lervo/repository-knowledge";
import { createProcessDocumentNormalizationCompiler } from "@lervo/repository-knowledge-compiler";
import { collectLocalKnowledgeSources } from "@lervo/repository-context";

const CANDIDATE_DIRECTORY = ".lervo/state/knowledge/normalization-candidates";
const MAXIMUM_PROVIDER_CALLS = 8;

/** A stored normalization candidate whose plan a repository-changing turn can review and apply. */
export interface NormalizationReview {
  pendingCount: number;
  candidateId: string;
  planId: string;
  items: ReadonlyArray<{ sourcePath: string; operationId: string; approvalHash: string }>;
}

type Provider = "codex" | "claude";

/**
 * Generates normalization candidates on the Node, outside any provider sandbox. A sandboxed
 * agent turn cannot start a nested provider process, so the turn only reviews and applies a
 * candidate stored here; generation runs in the background and never delays a reply.
 */
export class NormalizationCandidatePreparer {
  private running: Promise<void> | null = null;
  private readonly abortController = new AbortController();

  constructor(
    private readonly options: {
      repositoryRoot: string;
      provider: Provider;
      executables?: Partial<Record<Provider, string>>;
      log?: (line: string) => void;
    },
  ) {}

  /** The reviewable candidate for this turn; starts generation when documents wait without one. */
  async review(): Promise<NormalizationReview | null> {
    const pendingCount = await pendingDocuments(this.options.repositoryRoot);
    if (pendingCount === 0) return null;
    const current = await this.reviewableCandidate(pendingCount);
    if (current === null) this.generate();
    return current;
  }

  /** Settles any background generation, for tests. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** Stops background generation at shutdown. */
  async close(): Promise<void> {
    this.abortController.abort(new Error("document normalization cancelled"));
    await this.running;
  }

  private async reviewableCandidate(pendingCount: number): Promise<NormalizationReview | null> {
    for (const candidateId of await storedCandidateIds(this.options.repositoryRoot)) {
      try {
        const candidate = await loadDocumentNormalizationCandidate({
          repositoryRoot: this.options.repositoryRoot,
          candidateId,
        });
        const plan = await createDocumentNormalizationPlan({
          repositoryRoot: this.options.repositoryRoot,
          candidate,
          now: new Date(),
          supplementalSources: await collectLocalKnowledgeSources(this.options.repositoryRoot),
        });
        if (plan.status !== "review_required" || plan.items.length === 0) continue;
        return {
          pendingCount,
          candidateId,
          planId: plan.planId,
          items: plan.items.map((item) => ({
            sourcePath: item.sourcePath,
            operationId: item.operationId,
            approvalHash: item.approvalHash,
          })),
        };
      } catch {
        // A stale or unreadable candidate is simply not reviewable; a fresh one replaces it.
      }
    }
    return null;
  }

  private generate(): void {
    if (this.running !== null || this.abortController.signal.aborted) return;
    const { repositoryRoot, provider } = this.options;
    this.running = (async () => {
      const compiler = await createProcessDocumentNormalizationCompiler({
        provider,
        ...(this.options.executables?.[provider] === undefined
          ? {}
          : { executable: this.options.executables[provider] }),
      });
      const compilation = await compileConfiguredDocumentNormalizationCandidateObserved({
        repositoryRoot,
        compiler,
        signal: this.abortController.signal,
        scope: "all_pending",
        ceilings: { maximumProviderCalls: MAXIMUM_PROVIDER_CALLS },
        supplementalSources: await collectLocalKnowledgeSources(repositoryRoot),
      });
      await storeDocumentNormalizationCandidate({
        repositoryRoot,
        candidate: compilation.candidate,
      });
    })()
      .catch((error: unknown) => {
        this.options.log?.(
          `Lervo document normalization candidate generation failed: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            400,
          ),
        );
      })
      .finally(() => {
        this.running = null;
      });
  }
}

async function pendingDocuments(repositoryRoot: string): Promise<number> {
  try {
    return (await inspectConfiguredDocumentNormalization({ repositoryRoot })).pendingDocuments
      .length;
  } catch {
    return 0;
  }
}

/** Stored candidate identifiers, newest first. */
async function storedCandidateIds(repositoryRoot: string): Promise<string[]> {
  const root = resolve(repositoryRoot, CANDIDATE_DIRECTORY);
  const found: Array<{ id: string; modifiedMs: number }> = [];
  let shards: string[];
  try {
    shards = await readdir(root);
  } catch {
    return [];
  }
  for (const shard of shards) {
    let names: string[];
    try {
      names = await readdir(resolve(root, shard));
    } catch {
      continue;
    }
    for (const name of names) {
      const match = /^(knorm_[a-f0-9]{24})\.json$/u.exec(name);
      if (match === null) continue;
      found.push({
        id: match[1]!,
        modifiedMs: (await stat(resolve(root, shard, name))).mtimeMs,
      });
    }
  }
  return found
    .sort((left, right) => right.modifiedMs - left.modifiedMs)
    .slice(0, 4)
    .map((item) => item.id);
}

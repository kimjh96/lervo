import type { RepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import type { SearchQueryProjection } from "@lervo/search";
import {
  canonicalJson,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
  sha256,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { createCurrentWorkstreamSearchProjectionContext } from "./search-projection-context.js";
import { inspectInstructionCatalog } from "./instruction-catalog.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { CliServices } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";

type CurrentWorkstream = Awaited<ReturnType<typeof verifiedCurrentWorkstream>>;
type PreparedKnowledge = Awaited<ReturnType<typeof scanConfiguredRepositoryKnowledge>>;
type Canonicalization = Awaited<ReturnType<typeof listCanonicalizationCandidates>>;

interface TerminalPromptCorpusPreparation {
  supplementalSources: Awaited<ReturnType<typeof collectLocalKnowledgeSources>>;
  instructionCatalog: Awaited<ReturnType<typeof inspectInstructionCatalog>>;
  canonicalization: { coverage: "complete" | "unavailable"; candidates: Canonicalization };
  preparedKnowledge: PreparedKnowledge;
}

interface TerminalPromptQueryPreparation {
  queryProjection: SearchQueryProjection;
  currentWorkstream: CurrentWorkstream;
  projectId: string;
  requestedLanguage: string;
}

export interface PreparedTerminalPromptInputs
  extends TerminalPromptCorpusPreparation, TerminalPromptQueryPreparation {
  requestDigest: string;
  repositorySnapshot: RepositorySnapshot;
}

export async function coordinateTerminalPromptPreparation(input: {
  requestDigest: string;
  prepareCorpus: () => Promise<TerminalPromptCorpusPreparation>;
  prepareQuery: () => Promise<TerminalPromptQueryPreparation>;
  captureSnapshot: () => Promise<RepositorySnapshot>;
}): Promise<PreparedTerminalPromptInputs> {
  const [corpus, query, repositorySnapshot] = await Promise.all([
    input.prepareCorpus(),
    input.prepareQuery(),
    input.captureSnapshot(),
  ]);
  if (
    corpus.preparedKnowledge.manifest.projectId !== query.projectId ||
    corpus.preparedKnowledge.policy.publication.language !== query.requestedLanguage
  ) {
    throw new Error("Terminal prompt preparation inputs changed during concurrent inspection.");
  }
  return { ...corpus, ...query, repositorySnapshot, requestDigest: input.requestDigest };
}

export async function prepareTerminalPromptInputs(input: {
  root: string;
  prompt: string;
  provider: TerminalIntegrationProvider;
  services: Pick<CliServices, "projectSearchQueries">;
  timing: TerminalStageObservationPort;
}): Promise<PreparedTerminalPromptInputs> {
  const requestDigest = sha256(input.prompt);
  return coordinateTerminalPromptPreparation({
    requestDigest,
    prepareCorpus: () =>
      input.timing.measure("corpus_preparation", async () => {
        const supplementalSources = await collectLocalKnowledgeSources(input.root);
        const [preparedKnowledge, canonicalization] = await Promise.all([
          scanConfiguredRepositoryKnowledge(input.root, { supplementalSources }),
          listCanonicalizationCandidates(input.root).then(
            (candidates) => ({ coverage: "complete" as const, candidates }),
            () => ({ coverage: "unavailable" as const, candidates: [] }),
          ),
        ]);
        const instructionCatalog = await inspectInstructionCatalog({
          repositoryRoot: input.root,
          supplementalSources,
          preparedKnowledge,
        });
        return { supplementalSources, instructionCatalog, canonicalization, preparedKnowledge };
      }),
    prepareQuery: () =>
      input.timing.measure("query_projection", async () => {
        const workstreamStorage = await openProjectStorage(input.root);
        try {
          const [policy, currentWorkstream] = await Promise.all([
            loadRepositoryKnowledgePolicy(input.root),
            verifiedCurrentWorkstream(workstreamStorage),
          ]);
          const searchProjectionContext =
            currentWorkstream === null
              ? { context: { contextRequirement: "none" as const }, contextAnchors: [] }
              : createCurrentWorkstreamSearchProjectionContext(currentWorkstream);
          const requestedLanguage = policy.publication.language;
          const queryProjection = await input.services.projectSearchQueries({
            request: input.prompt,
            requestDigest,
            context: searchProjectionContext.context,
            contextDigest: sha256(canonicalJson(searchProjectionContext.context)),
            contextAnchors: searchProjectionContext.contextAnchors,
            requestedLanguage,
            provider: input.provider,
          });
          return {
            queryProjection,
            currentWorkstream,
            projectId: workstreamStorage.manifest.projectId,
            requestedLanguage,
          };
        } finally {
          await workstreamStorage.close();
        }
      }),
    captureSnapshot: () =>
      input.timing.measure("repository_snapshot", () =>
        captureTerminalRepositorySnapshot(input.root, input.timing.deadlineMs),
      ),
  });
}

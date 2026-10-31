export const supportedRepositoryPublicationLanguages = ["en"] as const;

export type RepositoryPublicationLanguage =
  (typeof supportedRepositoryPublicationLanguages)[number];
export type RepositoryPublicationGroup =
  | "agent_instructions"
  | "agent_workflows"
  | "agent_definitions"
  | "architecture"
  | "specifications"
  | "decisions"
  | "documentation"
  | "historical";

export interface RepositoryPublicationMessages {
  repositoryKnowledge: string;
  inventory: string;
  knowledgeMap: string;
  startingPoint: string;
  evidenceSemantics: string;
  generatedOverview: string;
  generatedNavigation: string;
  noPublications: string;
  evidenceExplanation: string;
  page: string;
  pages: string;
  catalog: string;
  generatedReadmeSummary: string;
  generatedAgentsPurpose: string;
  readmeStartHeading: string;
  repositoryKnowledgeEntry(indexPath: string): string;
  readmeRules: readonly string[];
  agentsTitle: string;
  sourceTitleFallback: string;
  agentKnowledgeEntry(indexPath: string): string;
  agentRules: readonly string[];
  publicationSnapshot(input: {
    snapshotId: string;
    included: number;
    includedBytes: number;
    excluded: number;
    unsupported: number;
  }): string;
  itemCount(count: number, singular: string, plural?: string): string;
  groups: Record<RepositoryPublicationGroup, string>;
  historicalLabel: string;
}

const english: RepositoryPublicationMessages = {
  repositoryKnowledge: "Repository knowledge",
  inventory: "Inventory",
  knowledgeMap: "Knowledge map",
  startingPoint: "Starting point",
  evidenceSemantics: "Evidence semantics",
  generatedOverview:
    "Lervo generated this structural index from bounded, read-only repository sources. It is a draft navigation aid, not a claim that an agent read or used every linked document.",
  generatedNavigation:
    "Generated navigation over user-owned publications. Linked source bytes remain at their original paths.",
  noPublications:
    "No existing Markdown publication was found. The inventory above was compiled from code, configuration, schema, test, build, log metadata, and bounded evidence sources. Add durable explanations as separate concepts instead of expanding this generated file manually.",
  evidenceExplanation:
    "Every registered concept sidecar points to exact source-unit versions. `unreviewed` means structural extraction only; query results are `recommended`, never `loaded`, `injected`, `referenced`, or `used` evidence.",
  page: "Page",
  pages: "Pages",
  catalog: "Catalog",
  generatedReadmeSummary:
    "This repository is initialized for local-first, evidence-bound work with Lervo.",
  generatedAgentsPurpose:
    "Use the repository knowledge entrypoint before changing code or documentation.",
  readmeStartHeading: "Start here",
  repositoryKnowledgeEntry: (indexPath) =>
    `Repository knowledge: run \`lervo migrate knowledge\`, then inspect \`${indexPath}\``,
  readmeRules: [
    "Run `lervo knowledge lint` before relying on generated knowledge.",
    "Run `lervo migrate knowledge` after durable repository sources change.",
  ],
  agentsTitle: "Repository Agent Instructions",
  sourceTitleFallback: "Repository source",
  agentKnowledgeEntry: (indexPath) =>
    `Run \`lervo migrate knowledge\` to build the local navigation at \`${indexPath}\`, which Git ignores, then read the directly relevant linked sources. Without Lervo, start from the tracked documentation.`,
  agentRules: [
    "Treat generated indexes as navigation, not proof that content was loaded or used.",
    "Preserve user-owned bytes and edit only explicitly managed Lervo blocks.",
    "Keep entrypoints short; put each independent concern in a separate document.",
    "Route durable outcomes by responsibility: behavioral obligations belong in canonical instruction documents, product and system facts in their owning specifications or decisions, and mutable continuation only in the current workstream.",
    "Before completion, assess whether changed evidence requires a canonical-source update or a review candidate; never rely on conversation memory or expand AGENTS with unrelated knowledge.",
    "Run the repository's relevant verification and `lervo knowledge lint` after changes.",
    "Translate explicit natural-language requests to hire, assign, inspect, resolve, hand off, or retire repository agents into the corresponding Lervo operation yourself; never ask the user to type bookkeeping commands.",
    "Resolve built-in and repository roles through the versioned role registry; create a custom role source only with its first requested artifact, and preserve exact role, capability, verification, ancestry, and hash validation.",
    "Register subagents with their parent agent and give them the same assignment, lease, evidence, verification, and finalization contract as root agents.",
  ],
  publicationSnapshot: ({ snapshotId, included, includedBytes, excluded, unsupported }) =>
    `Publication input snapshot: \`${snapshotId}\`. Included ${included} publishable sources (${includedBytes} bytes), excluded ${excluded}, unsupported ${unsupported}. This coordinate binds the structural source set and intentionally omits revision metadata, verification results, execution events, and local-inventory-only agent surfaces. A full query snapshot may differ while this publication remains current; use \`lervo migrate knowledge\` to determine currency.`,
  itemCount: (count, singular, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`,
  groups: {
    agent_instructions: "Agent instructions",
    agent_workflows: "Agent workflows",
    agent_definitions: "Agent definitions",
    architecture: "Architecture and vision",
    specifications: "Specifications and reference",
    decisions: "Decisions",
    documentation: "Documentation",
    historical: "Historical documents (not current design)",
  },
  historicalLabel: "historical, not current design",
};

export function repositoryPublicationMessages(language: string): RepositoryPublicationMessages {
  if (language === "en") return english;
  throw new Error(`Unsupported repository publication language: ${language}`);
}

export type RepositoryDocumentRewritePolicy =
  "repository_tool" | "lervo_exact" | "reviewed_exact" | "managed_regions";

export interface RepositoryDocumentRole {
  roleId: string;
  scopePath: string;
  path: string;
  cardinality: "one" | "one_per_package";
  /**
   * `tool_generated`: a repository tool, such as a release generator, writes these bytes; Lervo
   * never normalizes, refreshes, or otherwise rewrites them (ADR-0473).
   */
  lifecycleOwner: "user" | "lervo" | "provider_adapter" | "tool_generated";
  relocation: "preserve" | "reviewed_move" | "exact_legacy_alias";
  rewritePolicy: RepositoryDocumentRewritePolicy;
  required: boolean;
  legacyAliases?: string[];
}

export interface RepositoryDocumentCapacityOverride {
  scopePath: string;
  role: "archive" | "catalog" | "generated_reference";
  maxDirectDocuments: number;
  maxDocumentBearingChildDirectories: number;
}

export interface RepositoryDocumentCapacityPolicy {
  maxDirectDocuments: number;
  maxDocumentBearingChildDirectories: number;
  maxRepositoryDocuments: number;
  maxNormalizedFamilyOutputs: number;
  overrides: RepositoryDocumentCapacityOverride[];
}

export interface RepositoryDocumentRewriteContract {
  maxRewriters: number;
  maxManagedRulesPerRewriter: number;
  maxManagedRuleBytes: number;
}

export interface RepositoryDocumentPolicy {
  capacity: RepositoryDocumentCapacityPolicy;
  roles: RepositoryDocumentRole[];
  rewrite: RepositoryDocumentRewriteContract;
}

export const defaultRepositoryDocumentPolicy: RepositoryDocumentPolicy = {
  capacity: {
    maxDirectDocuments: 32,
    maxDocumentBearingChildDirectories: 32,
    maxRepositoryDocuments: 4096,
    maxNormalizedFamilyOutputs: 12,
    overrides: [],
  },
  roles: [
    {
      roleId: "public_overview",
      scopePath: ".",
      path: "README.md",
      cardinality: "one",
      lifecycleOwner: "user",
      relocation: "preserve",
      rewritePolicy: "repository_tool",
      required: false,
    },
    {
      roleId: "product_vision",
      scopePath: ".",
      path: "docs/product/vision.md",
      cardinality: "one",
      lifecycleOwner: "user",
      relocation: "reviewed_move",
      rewritePolicy: "reviewed_exact",
      required: false,
      legacyAliases: ["VISION.md", "PRODUCT_VISION.md"],
    },
    {
      roleId: "system_architecture",
      scopePath: ".",
      path: "docs/architecture/system.md",
      cardinality: "one",
      lifecycleOwner: "user",
      relocation: "reviewed_move",
      rewritePolicy: "reviewed_exact",
      required: false,
      legacyAliases: ["ARCHITECTURE.md", "SYSTEM_ARCHITECTURE.md"],
    },
    {
      roleId: "execution_specification",
      scopePath: ".",
      path: "docs/specifications/execution.md",
      cardinality: "one",
      lifecycleOwner: "user",
      relocation: "reviewed_move",
      rewritePolicy: "reviewed_exact",
      required: false,
      legacyAliases: ["EXECUTION_SPEC.md", "EXECUTION_SPECIFICATION.md"],
    },
    {
      roleId: "delivery_roadmap",
      scopePath: ".",
      path: "docs/roadmap/index.md",
      cardinality: "one",
      lifecycleOwner: "user",
      relocation: "reviewed_move",
      rewritePolicy: "reviewed_exact",
      required: false,
      legacyAliases: ["ROADMAP.md"],
    },
    {
      roleId: "continuation_source",
      scopePath: ".",
      path: ".lervo/state/workstreams/current.json",
      cardinality: "one",
      lifecycleOwner: "lervo",
      relocation: "exact_legacy_alias",
      rewritePolicy: "lervo_exact",
      required: false,
      legacyAliases: ["HANDOFF.md"],
    },
  ],
  rewrite: {
    maxRewriters: 16,
    maxManagedRulesPerRewriter: 256,
    maxManagedRuleBytes: 16 * 1024,
  },
};

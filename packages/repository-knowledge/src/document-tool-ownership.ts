import { posix } from "node:path";

import type { RepositoryDocumentRole } from "@lervo/project";

/**
 * ADR-0471 evidence that a repository tool, not a person or Lervo, owns a document's bytes. Each
 * kind is a fact the repository itself declares or records; none is inferred from a file name.
 */
export type DocumentToolOwnershipEvidence =
  | { kind: "layout_role"; roleId: string }
  | { kind: "generator_configuration"; generator: "release_please"; configurationPath: string }
  | { kind: "repository_attribute"; attribute: "linguist-generated" }
  | { kind: "generated_marker" }
  | { kind: "tool_commit_history"; commitCount: number };

export const RELEASE_PLEASE_CONFIGURATION_PATH = "release-please-config.json";
export const RELEASE_PLEASE_MANIFEST_PATH = ".release-please-manifest.json";
const RELEASE_PLEASE_DEFAULT_CHANGELOG = "CHANGELOG.md";
const MARKER_LINES = 5;

const safeRelativePath = (path: string): boolean =>
  path !== "" &&
  !posix.isAbsolute(path) &&
  posix.normalize(path) === path &&
  path !== ".." &&
  !path.startsWith("../");

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The changelog files release-please writes, from its manifest configuration: each declared
 * package writes `<package>/<changelog-path>` unless it skips the changelog. Package paths come
 * from the configuration's `packages` and the manifest's keys. Invalid input yields nothing.
 */
export function releasePleaseChangelogPaths(input: {
  configuration: unknown;
  manifest: unknown;
}): string[] {
  const configuration = record(input.configuration);
  if (configuration === null) return [];
  const packages = record(configuration.packages) ?? {};
  const manifest = record(input.manifest) ?? {};
  const defaults = {
    changelogPath: configuration["changelog-path"],
    skip: configuration["skip-changelog"],
  };
  const paths = new Set<string>();
  for (const packagePath of new Set([...Object.keys(packages), ...Object.keys(manifest)])) {
    const options = record(packages[packagePath]) ?? {};
    const skip = options["skip-changelog"] ?? defaults.skip;
    if (skip === true) continue;
    const changelog = options["changelog-path"] ?? defaults.changelogPath;
    const relative = typeof changelog === "string" ? changelog : RELEASE_PLEASE_DEFAULT_CHANGELOG;
    const path =
      packagePath === "." || packagePath === ""
        ? posix.normalize(relative)
        : posix.normalize(posix.join(packagePath, relative));
    if (safeRelativePath(path)) paths.add(path);
  }
  return [...paths].sort();
}

/**
 * A conventional generated-file marker in the first lines: the `@generated` tag or Go's
 * `Code generated ... DO NOT EDIT.` header. Lervo's own `lervo:generated` markers are not tool
 * markers; Lervo-generated documents have their own lifecycle owner.
 */
export function hasGeneratedFileMarker(content: string): boolean {
  return content
    .split("\n", MARKER_LINES)
    .some(
      (line) =>
        /(?:^|[\s/*#<!-])@generated(?:\s|$|-->|\*\/)/u.test(line) ||
        /^\s*(?:\/\/|#|<!--)?\s*Code generated .* DO NOT EDIT\.?/u.test(line),
    );
}

/** GitHub records an App or bot account as `<name>[bot]`, in the name and the noreply address. */
export function isAutomationCommitIdentity(identity: { name: string; email: string }): boolean {
  return (
    /\[bot\]$/u.test(identity.name.trim()) ||
    /^(?:\d+\+)?[^@\s]+\[bot\]@users\.noreply\.github\.com$/u.test(identity.email.trim())
  );
}

/** Whether a document-layout role declares this exact path tool-generated. */
export function toolGeneratedLayoutRole(
  path: string,
  roles: readonly Pick<
    RepositoryDocumentRole,
    "roleId" | "path" | "cardinality" | "lifecycleOwner"
  >[],
): string | null {
  for (const role of roles) {
    if (role.lifecycleOwner !== "tool_generated") continue;
    if (path === role.path) return role.roleId;
    if (role.cardinality === "one_per_package" && path.endsWith(`/${role.path}`))
      return role.roleId;
  }
  return null;
}

/**
 * Aggregates per-path evidence. History is evidence only when every non-Lervo commit observed for
 * the path came from an automation identity, so one human edit keeps the document user-owned.
 */
export function documentToolOwnership(input: {
  path: string;
  roles: readonly Pick<
    RepositoryDocumentRole,
    "roleId" | "path" | "cardinality" | "lifecycleOwner"
  >[];
  generatorOutputs: ReadonlyMap<string, DocumentToolOwnershipEvidence>;
  generatedAttribute: boolean;
  leadingContent: string | null;
  history: readonly { name: string; email: string }[];
}): DocumentToolOwnershipEvidence[] {
  const evidence: DocumentToolOwnershipEvidence[] = [];
  const roleId = toolGeneratedLayoutRole(input.path, input.roles);
  if (roleId !== null) evidence.push({ kind: "layout_role", roleId });
  const generator = input.generatorOutputs.get(input.path);
  if (generator !== undefined) evidence.push(generator);
  if (input.generatedAttribute)
    evidence.push({ kind: "repository_attribute", attribute: "linguist-generated" });
  if (input.leadingContent !== null && hasGeneratedFileMarker(input.leadingContent))
    evidence.push({ kind: "generated_marker" });
  if (input.history.length > 0 && input.history.every(isAutomationCommitIdentity))
    evidence.push({ kind: "tool_commit_history", commitCount: input.history.length });
  return evidence;
}

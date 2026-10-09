import { extname } from "node:path";

import { knowledgeScannerExcludes } from "./knowledge-intake-policy.js";
import { repositoryAgentArtifactForPath } from "./agent-artifact-profile.js";
import type { RepositoryKnowledgePolicy, RepositorySource, RepositorySourceKind } from "./types.js";

export const binaryExtensions = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".pdf",
  ".png",
  ".pyc",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
]);

const secretName =
  /(^|\/)(\.env(?:\.|$)|[^/]*(?:secret|credential|token)[^/]*|id_[dr]sa|[^/]*\.(?:pem|key|p12|pfx))$/i;
const decisionDocumentName = /(?:^|\/)(?:adr|decisions)(?:\/[^/]+)*\/\d{4}-.+\.md$/iu;

export function secretCandidatePath(path: string): boolean {
  return secretName.test(path) && !decisionDocumentName.test(path);
}
const instructionName = /(^|\/)(GEMINI\.md)$/i;
const testPath = /(^|\/)(test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const schemaPath = /(^|\/)(schemas?|migrations?)\/|\.schema\.json$/i;
const buildName =
  /(^|\/)(package\.json|pnpm-workspace\.yaml|Cargo\.toml|go\.mod|Makefile|Dockerfile|docker-compose[^/]*|.*\.(?:gradle|csproj|sln))$/i;
const logPath = /(^|\/)(logs?|traces?)\/|\.(?:log|out)$/i;
const configExtension = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini"]);
const codeExtension = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

export function repositorySourceKindForPath(path: string): RepositorySourceKind {
  const extension = extname(path).toLowerCase();
  if (decisionDocumentName.test(path)) return "documentation";
  const agentArtifact = repositoryAgentArtifactForPath(path);
  if (agentArtifact?.role === "behavioral_instruction") return "instruction";
  if (agentArtifact?.role === "skill" || agentArtifact?.role === "skill_resource")
    return "skill_contract";
  if (agentArtifact?.role === "legacy_command") return "agent_workflow";
  if (agentArtifact?.role === "agent_definition") return "agent_definition";
  if (agentArtifact?.role === "execution_policy") return "execution_policy";
  if (agentArtifact !== undefined) return "agent_configuration";
  if (instructionName.test(path)) return "instruction";
  if (testPath.test(path)) return "test";
  if (schemaPath.test(path)) return "schema";
  if (buildName.test(path)) return "build_definition";
  if (logPath.test(path)) return "log";
  if (extension === ".md" || extension === ".mdx" || extension === ".rst" || extension === ".txt") {
    return "documentation";
  }
  if (configExtension.has(extension)) return "configuration";
  if (codeExtension.has(extension)) return "code";
  return "other";
}

export function generatedEntrypoint(path: string, content: string): boolean {
  return (
    (path === "README.md" &&
      content.startsWith("<!-- lervo:generated repository-entrypoint-v1 -->\n")) ||
    (path === "AGENTS.md" &&
      content.startsWith("<!-- lervo:generated repository-agent-entrypoint-v1 -->\n"))
  );
}

export function repositoryPathCanRemainIncluded(
  path: string,
  policy: RepositoryKnowledgePolicy,
): boolean {
  return !knowledgeScannerExcludes(path, policy) && !secretCandidatePath(path);
}

export function repositorySourceClassificationForPath(path: string): "ordinary" | "sensitive" {
  if (decisionDocumentName.test(path)) return "ordinary";
  if (repositoryAgentArtifactForPath(path)?.contentHandling === "local_inventory_only")
    return "sensitive";
  if (logPath.test(path)) return "sensitive";
  return /(^|\/)(SECURITY|PRIVATE)(\.md)?$/i.test(path) ? "sensitive" : "ordinary";
}

export function agentArtifactFields(
  path: string,
): Pick<RepositorySource, "agentArtifact"> | Record<string, never> {
  const agentArtifact = repositoryAgentArtifactForPath(path);
  return agentArtifact === undefined ? {} : { agentArtifact };
}

export function opaqueSkillResourceFields(
  path: string,
): Pick<RepositorySource, "agentArtifact"> | Record<string, never> {
  const agentArtifact = repositoryAgentArtifactForPath(path);
  if (agentArtifact?.role !== "skill_resource") return {};
  return { agentArtifact: { ...agentArtifact, contentHandling: "opaque_resource" } };
}

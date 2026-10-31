import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";
export function compileFailure(message: string): RepositoryKnowledgeError {
  return new RepositoryKnowledgeError("knowledge_compile_failed", message);
}

export function policyFailure(message: string): RepositoryKnowledgeError {
  return new RepositoryKnowledgeError("knowledge_compile_policy_violation", message);
}

export function parsedJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw compileFailure(message);
  }
}

export function parsedJsonObject(value: string, message: string): Record<string, unknown> {
  const parsed = parsedJson(value, message);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw compileFailure(message);
  return parsed as Record<string, unknown>;
}

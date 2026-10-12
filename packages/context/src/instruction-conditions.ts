import { matchesGlob } from "node:path";
import { parse } from "yaml";
import { normalizeRepositoryPath } from "./paths.js";
import { instructionScopeError, type InstructionApplicability } from "./instruction-scope.js";

/** Explicit task coordinates. Missing coordinates remain unknown, never keyword-derived authority. */
export interface InstructionTargets {
  artifactKinds?: readonly string[];
  requestedActions?: readonly string[];
  taskDigest?: string;
}
interface Selector {
  paths?: string[];
  artifactKinds?: string[];
  requestedActions?: string[];
  taskDigests?: string[];
}
export interface InstructionConditions {
  when: Selector;
  except: Selector[];
  supersedes: string[];
  decision?: { key: string; value: string };
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("object");
  return value as Record<string, unknown>;
}
function labels(value: unknown, maximum = 32): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !identifier.test(item))
  )
    throw new TypeError("bounded identifiers");
  return [...new Set(value as string[])].sort();
}
function selector(value: unknown): Selector {
  const raw = record(value);
  const result: Selector = {};
  if (Object.keys(raw).length === 0) throw new TypeError("empty selector");
  for (const [key, items] of Object.entries(raw)) {
    if (key === "paths") {
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.length > 64 ||
        items.some((item) => typeof item !== "string" || item.length > 1024)
      )
        throw new TypeError("paths");
      result.paths = [...new Set((items as string[]).map(normalizeRepositoryPath))].sort();
    } else if (key === "artifactKinds" || key === "requestedActions") result[key] = labels(items);
    else if (key === "taskDigests") {
      result.taskDigests = labels(items);
      if (result.taskDigests.some((hash) => !/^sha256:[a-f0-9]{64}$/u.test(hash)))
        throw new TypeError("task digest");
    } else throw new TypeError("unknown selector");
  }
  return result;
}

/** Versioned descriptors belong only to canonical instructions, not retrieved prose. */
export function readInstructionConditions(content: string): InstructionConditions | undefined {
  try {
    const text = content.replace(/^\uFEFF/u, "");
    if (!/^---\r?\n/u.test(text)) return undefined;
    const start = text.indexOf("\n") + 1;
    const end = /\r?\n---(?:\r?\n|$)/u.exec(text.slice(start));
    if (!end || end.index > 8192) throw new TypeError("frontmatter bounds");
    const metadata = record(parse(text.slice(start, start + end.index), { maxAliasCount: 0 }));
    if (metadata.lervo === undefined) return undefined;
    const rawValue = record(metadata.lervo).contextScope;
    if (rawValue === undefined) return undefined;
    const raw = record(rawValue);
    if (
      raw.schemaVersion !== 1 ||
      Object.keys(raw).some(
        (key) => !["schemaVersion", "when", "except", "supersedes", "decision"].includes(key),
      )
    )
      throw new TypeError("scope version or property");
    const result: InstructionConditions = {
      when: raw.when === undefined ? {} : selector(raw.when),
      except: [],
      supersedes: [],
    };
    if (raw.except !== undefined) {
      if (!Array.isArray(raw.except) || raw.except.length > 16) throw new TypeError("exceptions");
      result.except = raw.except.map(selector);
    }
    if (raw.supersedes !== undefined) result.supersedes = labels(raw.supersedes, 64);
    if (raw.decision !== undefined) {
      const decision = record(raw.decision);
      if (Object.keys(decision).length !== 2) throw new TypeError("decision");
      result.decision = { key: labels([decision.key])[0]!, value: labels([decision.value])[0]! };
    }
    return result;
  } catch (error) {
    throw instructionScopeError(error);
  }
}
function match(
  selector: Selector,
  paths: readonly string[] | null,
  task: InstructionTargets,
): InstructionApplicability {
  let unknown = false;
  for (const key of ["paths", "artifactKinds", "requestedActions", "taskDigests"] as const) {
    const expected = selector[key];
    if (!expected) continue;
    const actual =
      key === "paths"
        ? paths
        : key === "taskDigests"
          ? task.taskDigest
            ? [task.taskDigest]
            : undefined
          : task[key];
    if (!actual?.length) {
      unknown = true;
      continue;
    }
    if (
      !expected.some((pattern) =>
        actual.some((value) =>
          key === "paths"
            ? value === pattern || value.startsWith(`${pattern}/`) || matchesGlob(value, pattern)
            : value === pattern,
        ),
      )
    )
      return "not_applicable";
  }
  return unknown ? "unresolved" : "applicable";
}
export function resolveInstructionConditions(
  base: InstructionApplicability,
  conditions: InstructionConditions | undefined,
  paths: readonly string[] | null,
  task: InstructionTargets,
): InstructionApplicability {
  if (!conditions || base === "not_applicable") return base;
  const inclusion = match(conditions.when, paths, task);
  if (inclusion === "not_applicable") return inclusion;
  const exceptions = conditions.except.map((item) => match(item, paths, task));
  if (exceptions.includes("applicable")) return "not_applicable";
  return base === "unresolved" || inclusion === "unresolved" || exceptions.includes("unresolved")
    ? "unresolved"
    : "applicable";
}

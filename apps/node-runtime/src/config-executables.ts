import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { NodeRuntimeConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";

/**
 * ADR-0487: one executable path a Node configuration names. `lervo_cli` fields name the Lervo
 * CLI bundle and follow the host's CLI pointer after `lervo upgrade`; the others name host tools.
 */
export interface NodeConfiguredExecutable {
  field: string;
  path: string;
  kind: "lervo_cli" | "node" | "provider" | "verification_tool" | "requested_runtime";
  /** `read` for a bundle that the Node passes to `node`; `execute` for a spawned program. */
  access: "execute" | "read";
  /** The Node cannot start without it; other fields fail only the work that uses them. */
  requiredAtStartup: boolean;
}

export interface NodeConfiguredExecutableProblem extends NodeConfiguredExecutable {
  problem: "missing" | "not_file" | "not_permitted";
}

type ExecutableFieldRule = Pick<
  NodeConfiguredExecutable,
  "kind" | "access" | "requiredAtStartup"
> & { pattern: RegExp };

/**
 * The configuration fields that hold executable paths. Conversation deployments are matched by
 * their nested field names, so every top-level conversation entry is covered alike.
 */
const EXECUTABLE_FIELDS: readonly ExecutableFieldRule[] = [
  {
    pattern: /\.deliberation\.cliExecutable$/u,
    kind: "lervo_cli",
    access: "execute",
    requiredAtStartup: true,
  },
  {
    pattern: /\.requestedRuntimes\[\d+\]\.executable$/u,
    kind: "requested_runtime",
    access: "execute",
    requiredAtStartup: false,
  },
  {
    pattern: /^outcomeSupervision\.managedExecution\.nodeExecutable$/u,
    kind: "node",
    access: "execute",
    requiredAtStartup: false,
  },
  {
    pattern: /^outcomeSupervision\.managedExecution\.cliBundle$/u,
    kind: "lervo_cli",
    access: "read",
    requiredAtStartup: false,
  },
  {
    pattern: /^outcomeSupervision\.runtimeReadiness\.providerExecutables\.[a-z]+$/u,
    kind: "provider",
    access: "execute",
    requiredAtStartup: false,
  },
  {
    pattern: /^outcomeSupervision\.runtimeReadiness\.verificationTools\.[^[]+\[\d+\]\.executable$/u,
    kind: "verification_tool",
    access: "execute",
    requiredAtStartup: false,
  },
  {
    pattern: /^remoteCommands\.providerHost\.executables\.[a-z]+$/u,
    kind: "provider",
    access: "execute",
    requiredAtStartup: false,
  },
];

function collect(value: unknown, field: string, entries: NodeConfiguredExecutable[]): void {
  if (typeof value === "string") {
    const rule = EXECUTABLE_FIELDS.find((candidate) => candidate.pattern.test(field));
    if (rule !== undefined && isAbsolute(value))
      entries.push({
        field,
        path: value,
        kind: rule.kind,
        access: rule.access,
        requiredAtStartup: rule.requiredAtStartup,
      });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, `${field}[${index}]`, entries));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value))
    collect(item, field.length === 0 ? key : `${field}.${key}`, entries);
}

/** Lists every absolute executable path in a parsed configuration, named by its field. */
export function listNodeConfiguredExecutables(
  config: NodeRuntimeConfig,
): NodeConfiguredExecutable[] {
  const entries: NodeConfiguredExecutable[] = [];
  collect(config, "", entries);
  return entries;
}

async function problemOf(
  entry: NodeConfiguredExecutable,
): Promise<NodeConfiguredExecutableProblem["problem"] | null> {
  // `stat` follows links, so a path through the host's `current` pointer is judged by its target.
  const metadata = await stat(entry.path).catch(() => null);
  if (metadata === null) return "missing";
  if (!metadata.isFile()) return "not_file";
  const mode = entry.access === "read" ? constants.R_OK : constants.X_OK;
  return (await access(entry.path, mode).then(
    () => true,
    () => false,
  ))
    ? null
    : "not_permitted";
}

/** Reports each configured executable that is absent, not a file, or not usable. */
export async function inspectNodeConfiguredExecutables(
  entries: readonly NodeConfiguredExecutable[],
): Promise<NodeConfiguredExecutableProblem[]> {
  const problems = await Promise.all(
    entries.map(async (entry) => {
      const problem = await problemOf(entry);
      return problem === null ? null : { ...entry, problem };
    }),
  );
  return problems.filter((item): item is NodeConfiguredExecutableProblem => item !== null);
}

/**
 * Refuses startup when an executable the Node needs to start is unusable, naming the field and
 * path, so a removed CLI install is not reported as an unreadable configuration.
 */
export async function assertNodeStartupExecutables(config: NodeRuntimeConfig): Promise<void> {
  const [problem] = await inspectNodeConfiguredExecutables(
    listNodeConfiguredExecutables(config).filter((entry) => entry.requiredAtStartup),
  );
  if (problem === undefined) return;
  const state =
    problem.problem === "missing"
      ? "does not exist"
      : problem.problem === "not_file"
        ? "is not a file"
        : "is not executable";
  throw new NodeRuntimeError(
    "configured_executable_unavailable",
    `The executable configured at ${problem.field} ${state}: ${problem.path}. Run \`lervo upgrade\` to point it at the installed CLI.`,
  );
}

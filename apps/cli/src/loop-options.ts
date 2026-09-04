import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { GovernedLoopPolicyV1, GovernedTokenLimitV1 } from "@lervo/application-contract";

import type { RunProvider } from "./managed-run.js";

export const loopUsage = [
  "  lervo loop status [--max-attempts <1-16>] [--max-parallel <1-32>] [--token-limit <provider>[:<scope>]:<descriptor-hash>:<tokens>] [--root <path>] [--json]",
  "  lervo loop board [--max-attempts <1-16>] [--max-parallel <1-32>] [--token-limit <provider>[:<scope>]:<descriptor-hash>:<tokens>] [--root <path>]",
  "  lervo loop objective [--root <path>] [--json]",
  "  lervo loop goal [--root <path>] [--json]",
  "  lervo loop budget [--token-limit <provider>[:<scope>]:<descriptor-hash>:<tokens>] [--root <path>] [--json]",
  "  lervo loop thread --assignment <id> [--root <path>] [--json]",
  "  lervo loop inbox --agent <id> [--root <path>] [--json]",
  "  lervo loop run --provider <codex|claude> --assignment <id> --agent <id> --lease <id> --path <relative-path> --verification <suite-id> [--verification <suite-id> ...] [--max-attempts <1-16>] [--max-parallel <1-32>] [--token-limit <provider>[:<scope>]:<descriptor-hash>:<tokens>] [--root <path>] [--risk <level>] [--json] <request>",
  "  lervo loop reconcile --assignment <id> [--apply <command-id> --write] [--root <path>] [--json]",
].join("\n");

interface LoopOptionsBase {
  repositoryRoot: string;
  policy: Partial<GovernedLoopPolicyV1>;
  json: boolean;
}

export type ParsedLoopOptions =
  | (LoopOptionsBase & { action: "help" })
  | (LoopOptionsBase & { action: "board" })
  | (LoopOptionsBase & { action: "budget" })
  | (LoopOptionsBase & { action: "objective" })
  | (LoopOptionsBase & { action: "goal" })
  | (LoopOptionsBase & { action: "thread"; assignmentId: string })
  | (LoopOptionsBase & { action: "inbox"; recipientAgentId: string })
  | (LoopOptionsBase & { action: "status" })
  | (LoopOptionsBase & {
      action: "reconcile";
      assignmentId: string;
      apply?: string;
      write: boolean;
    })
  | (LoopOptionsBase & {
      action: "run";
      provider: RunProvider;
      assignmentId: string;
      agentId: string;
      leaseId: string;
      expectedPath: string;
      verificationSuiteIds: string[];
      instructions: string;
      risk: string;
      skillIds: string[];
      capabilityIds: string[];
      roleId?: string;
    });

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("A governed-loop integer is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error("A governed-loop integer exceeds its bound.");
  }
  return parsed;
}

function tokenLimits(values: string[] | undefined): GovernedTokenLimitV1[] {
  return (values ?? []).map((value) => {
    const match =
      /^(codex|claude|lervo):(?:(primary_provider|subagent_provider|query_projection|publication_evaluation|deliberation|improvement_evaluation):)?(sha256:[a-f0-9]{64}):([1-9]\d*)$/u.exec(
        value,
      );
    if (match === null) {
      throw new Error("--token-limit requires <provider>[:<scope>]:<descriptor-hash>:<tokens>.");
    }
    return {
      provider: match[1] as GovernedTokenLimitV1["provider"],
      ...(match[2] === undefined
        ? {}
        : { scope: match[2] as NonNullable<GovernedTokenLimitV1["scope"]> }),
      accountingDescriptorHash: match[3]!,
      stopAfterObservedTotalTokens: Number(match[4]),
    };
  });
}

export function parseLoopOptions(args: string[], cwd: string): ParsedLoopOptions {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      provider: { type: "string" },
      assignment: { type: "string" },
      agent: { type: "string" },
      lease: { type: "string" },
      path: { type: "string" },
      verification: { type: "string", multiple: true },
      role: { type: "string" },
      risk: { type: "string" },
      skill: { type: "string", multiple: true },
      capability: { type: "string", multiple: true },
      "max-attempts": { type: "string" },
      "max-parallel": { type: "string" },
      "token-limit": { type: "string", multiple: true },
      "unobserved-resource": { type: "string" },
      "exhausted-resource": { type: "string" },
      "terminal-failure": { type: "string" },
      apply: { type: "string" },
      write: { type: "boolean" },
    },
  });
  const dispositions = [
    parsed.values["unobserved-resource"] ?? "escalate",
    parsed.values["exhausted-resource"] ?? "block",
    parsed.values["terminal-failure"] ?? "escalate",
  ];
  if (dispositions.some((value) => value !== "block" && value !== "escalate")) {
    throw new Error("A loop disposition must be block or escalate.");
  }
  const base: LoopOptionsBase = {
    repositoryRoot: resolve(cwd, parsed.values.root ?? "."),
    json: parsed.values.json ?? false,
    policy: {
      maxAttemptsPerAssignment: positiveInteger(parsed.values["max-attempts"], 2, 16),
      maxParallelAssignments: positiveInteger(parsed.values["max-parallel"], 2, 32),
      tokenLimits: tokenLimits(parsed.values["token-limit"]),
      unobservedResourceAction: dispositions[0] as "block" | "escalate",
      exhaustedResourceAction: dispositions[1] as "block" | "escalate",
      terminalFailureAction: dispositions[2] as "block" | "escalate",
    },
  };
  if (parsed.values.help) return { ...base, action: "help" };
  const action = parsed.positionals.shift();
  if (action === "status") {
    if (parsed.positionals.length > 0) throw new Error("Loop status accepts no request text.");
    return { ...base, action };
  }
  if (action === "board") {
    if (parsed.positionals.length > 0 || base.json) {
      throw new Error("Loop board accepts no request text or --json output.");
    }
    return { ...base, action };
  }
  if (action === "objective" || action === "goal" || action === "budget") {
    if (parsed.positionals.length > 0) {
      throw new Error(`Loop ${action} accepts no request text.`);
    }
    return { ...base, action };
  }
  if (action === "thread") {
    if (
      parsed.positionals.length > 0 ||
      parsed.values.assignment === undefined ||
      parsed.values.write
    ) {
      throw new Error("Loop thread requires one assignment and is read-only.");
    }
    return { ...base, action, assignmentId: parsed.values.assignment };
  }
  if (action === "inbox") {
    if (parsed.positionals.length > 0 || parsed.values.agent === undefined || parsed.values.write) {
      throw new Error("Loop inbox requires one recipient agent and is read-only.");
    }
    return { ...base, action, recipientAgentId: parsed.values.agent };
  }
  if (action === "reconcile") {
    if (
      parsed.positionals.length > 0 ||
      parsed.values.assignment === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    ) {
      throw new Error(
        "Loop reconcile requires an assignment and pairs --apply with --write when applying.",
      );
    }
    return {
      ...base,
      action,
      assignmentId: parsed.values.assignment,
      ...(parsed.values.apply === undefined ? {} : { apply: parsed.values.apply }),
      write: parsed.values.write ?? false,
    };
  }
  if (action !== "run") throw new Error("The loop action is invalid.");

  const provider = parsed.values.provider;
  const assignmentId = parsed.values.assignment;
  const agentId = parsed.values.agent;
  const leaseId = parsed.values.lease;
  const expectedPath = parsed.values.path;
  const verificationSuiteIds = parsed.values.verification ?? [];
  const instructions = parsed.positionals.join(" ").trim();
  if (
    (provider !== "codex" && provider !== "claude") ||
    assignmentId === undefined ||
    agentId === undefined ||
    leaseId === undefined ||
    expectedPath === undefined ||
    verificationSuiteIds.length === 0 ||
    instructions.length === 0
  ) {
    throw new Error(
      "Loop run requires provider, assignment, agent, lease, path, verification, and request.",
    );
  }
  return {
    ...base,
    action,
    provider,
    assignmentId,
    agentId,
    leaseId,
    expectedPath,
    verificationSuiteIds,
    instructions,
    risk: parsed.values.risk ?? "medium",
    skillIds: parsed.values.skill ?? [],
    capabilityIds: parsed.values.capability ?? [],
    ...(parsed.values.role === undefined ? {} : { roleId: parsed.values.role }),
  };
}

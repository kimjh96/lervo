import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { GovernedLoopPolicyV1 } from "@lervo/application-contract";
import { normalizeRepositoryPath } from "@lervo/context";

import { boundedPositiveInteger, parseGovernedLoopPolicy } from "./loop-policy-options.js";
import type { RunProvider } from "./managed-run.js";

export interface ParsedUnattendedSchedulerOptions {
  action: "schedule";
  repositoryRoot: string;
  policy: Partial<GovernedLoopPolicyV1>;
  json: boolean;
  provider: RunProvider;
  eligibleAgentIds: string[];
  pollIntervalMs: number;
  maximumCycles: number;
  maximumClaims: number;
  maximumManagedRuns: number;
  maximumRuntimeMs: number;
  maximumConsecutiveFailures: number;
  leaseDurationMs: number;
  killSwitchPath: string;
  risk: string;
}

export function parseUnattendedSchedulerOptions(
  args: string[],
  cwd: string,
): ParsedUnattendedSchedulerOptions {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      write: { type: "boolean" },
      provider: { type: "string" },
      agent: { type: "string", multiple: true },
      "poll-ms": { type: "string" },
      "max-cycles": { type: "string" },
      "max-claims": { type: "string" },
      "max-runs": { type: "string" },
      "runtime-ms": { type: "string" },
      "failure-limit": { type: "string" },
      "lease-ms": { type: "string" },
      "kill-switch": { type: "string" },
      risk: { type: "string" },
      "max-attempts": { type: "string" },
      "max-parallel": { type: "string" },
      "token-limit": { type: "string", multiple: true },
      "token-metric-limit": { type: "string", multiple: true },
      "duration-limit": { type: "string", multiple: true },
      "unobserved-resource": { type: "string" },
      "exhausted-resource": { type: "string" },
      "terminal-failure": { type: "string" },
    },
  });
  if (
    parsed.positionals.length !== 1 ||
    parsed.positionals[0] !== "schedule" ||
    !parsed.values.write
  ) {
    throw new Error("Loop schedule requires only the schedule action and explicit --write.");
  }
  const provider = parsed.values.provider;
  if (provider !== "codex" && provider !== "claude") {
    throw new Error("Loop schedule requires --provider codex or claude.");
  }
  const eligibleAgentIds = [...new Set(parsed.values.agent ?? [])].sort();
  if (
    eligibleAgentIds.length > 32 ||
    eligibleAgentIds.some((agentId) => !/^agt_[a-f0-9]{24}$/u.test(agentId))
  ) {
    throw new Error("Loop schedule agent filters are invalid or exceed 32 agents.");
  }
  const risk = (parsed.values.risk ?? "medium").trim();
  if (risk.length === 0 || risk.length > 100) throw new Error("Loop schedule risk is invalid.");
  return {
    action: "schedule",
    repositoryRoot: resolve(cwd, parsed.values.root ?? "."),
    policy: parseGovernedLoopPolicy(parsed.values),
    json: parsed.values.json ?? false,
    provider,
    eligibleAgentIds,
    pollIntervalMs: boundedPositiveInteger(
      parsed.values["poll-ms"],
      30_000,
      3_600_000,
      "scheduler poll interval",
      100,
    ),
    maximumCycles: boundedPositiveInteger(
      parsed.values["max-cycles"],
      120,
      10_000,
      "scheduler cycle limit",
    ),
    maximumClaims: boundedPositiveInteger(
      parsed.values["max-claims"],
      32,
      512,
      "scheduler claim limit",
    ),
    maximumManagedRuns: boundedPositiveInteger(
      parsed.values["max-runs"],
      32,
      512,
      "scheduler managed-run limit",
    ),
    maximumRuntimeMs: boundedPositiveInteger(
      parsed.values["runtime-ms"],
      3_600_000,
      86_400_000,
      "scheduler runtime limit",
      1_000,
    ),
    maximumConsecutiveFailures: boundedPositiveInteger(
      parsed.values["failure-limit"],
      3,
      16,
      "scheduler failure limit",
    ),
    leaseDurationMs: boundedPositiveInteger(
      parsed.values["lease-ms"],
      30 * 60_000,
      30 * 60_000,
      "scheduler lease duration",
      5_000,
    ),
    killSwitchPath: normalizeRepositoryPath(
      parsed.values["kill-switch"] ?? ".lervo/state/unattended-scheduler.stop",
    ),
    risk,
  };
}

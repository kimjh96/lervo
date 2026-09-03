import {
  validateSchema,
  type TerminalBudgetPolicy,
  type TerminalBudgetReport,
  type TerminalCoverageReport,
} from "@lervo/schemas";

import { DiagnosticsError } from "./types.js";

type HookProfile = TerminalBudgetReport["hookProfiles"][number];
type HookObservation = TerminalCoverageReport["reports"][number]["stages"]["observations"][number];

interface MutableHookProfile {
  provider: string;
  hookEvent: HookProfile["hookEvent"];
  environmentProfileDigest: string;
  repositoryProfile: HookProfile["repositoryProfile"];
  coldState: HookProfile["coldState"];
  durations: number[];
  incompleteOutcomes: number;
}

const defaultTerminalBudgetPolicy: TerminalBudgetPolicy = {
  schemaVersion: 1,
  promptP95BudgetMs: 15_000,
  stopP95BudgetMs: 5_000,
  maximumHookDurationMs: 30_000,
  minimumSamples: 30,
  maxQueryProjectionTokens: null,
  unobservedAction: "escalate",
  exhaustedAction: "block",
};

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function totalStage(observation: HookObservation) {
  return observation.stages.find((stage) => stage.stageId === "total");
}

function disposition(input: {
  exhausted: boolean;
  unobservable: boolean;
  policy: TerminalBudgetPolicy;
}): TerminalBudgetReport["disposition"] {
  if (
    (input.exhausted && input.policy.exhaustedAction === "block") ||
    (input.unobservable && input.policy.unobservedAction === "block")
  )
    return "blocked";
  if (input.exhausted || input.unobservable) return "escalation_required";
  return "passed";
}

export function createTerminalBudgetReport(input: {
  coverage: TerminalCoverageReport;
  policy?: Partial<
    Pick<
      TerminalBudgetPolicy,
      "minimumSamples" | "maxQueryProjectionTokens" | "unobservedAction" | "exhaustedAction"
    >
  >;
}): TerminalBudgetReport {
  const policy: TerminalBudgetPolicy = {
    ...defaultTerminalBudgetPolicy,
    minimumSamples: input.policy?.minimumSamples ?? defaultTerminalBudgetPolicy.minimumSamples,
    maxQueryProjectionTokens:
      input.policy?.maxQueryProjectionTokens ??
      defaultTerminalBudgetPolicy.maxQueryProjectionTokens,
    unobservedAction:
      input.policy?.unobservedAction ?? defaultTerminalBudgetPolicy.unobservedAction,
    exhaustedAction: input.policy?.exhaustedAction ?? defaultTerminalBudgetPolicy.exhaustedAction,
  };
  const policyValidation = validateSchema("terminalBudgetPolicy", policy);
  if (!policyValidation.valid)
    throw new DiagnosticsError("terminal_budget_invalid", "Terminal budget policy is invalid.");

  const mutableProfiles = new Map<string, MutableHookProfile>();
  let missingHookObservationCount = 0;
  let incompleteHookOutcomeCount = 0;
  let invalidStageObservationSetCount = 0;
  for (const report of input.coverage.reports) {
    if (report.stages.completeness === "invalid") {
      invalidStageObservationSetCount += 1;
      continue;
    }
    const observations = new Map(
      report.stages.observations.map((observation) => [observation.hookEvent, observation]),
    );
    const expectedHooks: HookProfile["hookEvent"][] =
      report.completedAt === null ? ["UserPromptSubmit"] : ["UserPromptSubmit", "Stop"];
    for (const hookEvent of expectedHooks) {
      const observation = observations.get(hookEvent);
      if (observation === undefined) {
        missingHookObservationCount += 1;
        continue;
      }
      const total = totalStage(observation);
      if (total === undefined) {
        missingHookObservationCount += 1;
        continue;
      }
      const key = [
        report.provider,
        hookEvent,
        observation.environmentProfileDigest,
        observation.repositoryProfile,
        total.coldState,
      ].join("\0");
      const profile = mutableProfiles.get(key) ?? {
        provider: report.provider,
        hookEvent,
        environmentProfileDigest: observation.environmentProfileDigest,
        repositoryProfile: observation.repositoryProfile,
        coldState: total.coldState,
        durations: [],
        incompleteOutcomes: 0,
      };
      if (total.outcome === "completed") profile.durations.push(total.durationMs);
      else {
        profile.incompleteOutcomes += 1;
        incompleteHookOutcomeCount += 1;
      }
      mutableProfiles.set(key, profile);
    }
  }

  const hookProfiles = [...mutableProfiles.values()]
    .filter((profile) => profile.durations.length > 0)
    .map<HookProfile>((profile) => {
      const p95DurationMs = percentile95(profile.durations);
      const maximumDurationMs = Math.max(...profile.durations);
      const budgetMs =
        profile.hookEvent === "UserPromptSubmit"
          ? policy.promptP95BudgetMs
          : policy.stopP95BudgetMs;
      const reasonCodes = [
        ...(profile.durations.length < policy.minimumSamples
          ? ["sample_population_insufficient"]
          : []),
        ...(profile.incompleteOutcomes > 0 ? ["hook_outcome_not_completed"] : []),
        ...(maximumDurationMs >= policy.maximumHookDurationMs ? ["external_ceiling_reached"] : []),
        ...(profile.durations.length >= policy.minimumSamples && p95DurationMs > budgetMs
          ? ["p95_budget_exceeded"]
          : []),
      ].sort();
      const exhausted = reasonCodes.some(
        (reason) => reason === "external_ceiling_reached" || reason === "p95_budget_exceeded",
      );
      return {
        provider: profile.provider,
        hookEvent: profile.hookEvent,
        environmentProfileDigest: profile.environmentProfileDigest,
        repositoryProfile: profile.repositoryProfile,
        coldState: profile.coldState,
        sampleCount: profile.durations.length,
        p95DurationMs,
        maximumDurationMs,
        budgetMs,
        status: exhausted ? "exhausted" : reasonCodes.length > 0 ? "unobservable" : "below",
        reasonCodes,
      };
    })
    .sort((left, right) =>
      [
        left.provider,
        left.hookEvent,
        left.environmentProfileDigest,
        left.repositoryProfile,
        left.coldState,
      ]
        .join("\0")
        .localeCompare(
          [
            right.provider,
            right.hookEvent,
            right.environmentProfileDigest,
            right.repositoryProfile,
            right.coldState,
          ].join("\0"),
        ),
    );

  const queryProjections: TerminalBudgetReport["queryProjections"] = input.coverage.reports.map(
    (report) => {
      const limitTokens = policy.maxQueryProjectionTokens;
      const observedTokens = report.resources.queryProjection.usage?.totalTokens ?? null;
      if (limitTokens === null) {
        return {
          provider: report.provider,
          contextEventId: report.contextEventId,
          observedTokens,
          limitTokens,
          status: "not_configured",
          reasonCode:
            observedTokens === null
              ? "query_projection_usage_unavailable"
              : "per_context_usage_only",
        };
      }
      if (observedTokens === null) {
        return {
          provider: report.provider,
          contextEventId: report.contextEventId,
          observedTokens,
          limitTokens,
          status: "unobservable",
          reasonCode: "query_projection_usage_unavailable",
        };
      }
      return {
        provider: report.provider,
        contextEventId: report.contextEventId,
        observedTokens,
        limitTokens,
        status: observedTokens >= limitTokens ? "exhausted" : "below",
        reasonCode: "per_context_usage_only",
      };
    },
  );
  const exhausted =
    hookProfiles.some((profile) => profile.status === "exhausted") ||
    queryProjections.some((assessment) => assessment.status === "exhausted");
  const unobservable =
    input.coverage.reports.length === 0 ||
    missingHookObservationCount > 0 ||
    incompleteHookOutcomeCount > 0 ||
    invalidStageObservationSetCount > 0 ||
    hookProfiles.some((profile) => profile.status === "unobservable") ||
    queryProjections.some((assessment) => assessment.status === "unobservable");
  const reasonCodes = [
    ...(input.coverage.reports.length === 0 ? ["terminal_coverage_unavailable"] : []),
    ...(missingHookObservationCount > 0 ? ["hook_observation_missing"] : []),
    ...(incompleteHookOutcomeCount > 0 ? ["hook_outcome_not_completed"] : []),
    ...(invalidStageObservationSetCount > 0 ? ["stage_observation_invalid"] : []),
    ...hookProfiles.flatMap((profile) => profile.reasonCodes),
    ...queryProjections.flatMap((assessment) =>
      assessment.status === "exhausted" || assessment.status === "unobservable"
        ? [assessment.reasonCode!]
        : [],
    ),
  ];
  const report: TerminalBudgetReport = {
    schemaVersion: 1,
    reportKind: "unmanaged_terminal_budget",
    projectId: input.coverage.projectId,
    policy,
    sourceReportCount: input.coverage.reports.length,
    missingHookObservationCount,
    incompleteHookOutcomeCount,
    invalidStageObservationSetCount,
    hookProfiles,
    queryProjections,
    wholeTaskUsage: {
      status: "unsupported",
      reasonCode: "unmanaged_provider_usage_unobserved",
    },
    disposition: disposition({ exhausted, unobservable, policy }),
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
  if (!validateSchema("terminalBudgetReport", report).valid)
    throw new DiagnosticsError(
      "terminal_budget_invalid",
      "Terminal budget report does not satisfy its versioned contract.",
    );
  return report;
}

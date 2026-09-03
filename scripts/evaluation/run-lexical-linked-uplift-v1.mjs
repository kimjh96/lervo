#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { executeLexicalLinkedUpliftTask } from "../natural-language-evaluation/lexical-linked-uplift-native-task.mjs";
import { prepareLexicalLinkedUpliftWorkspace } from "../natural-language-evaluation/lexical-linked-uplift-workspace.mjs";

const sourceRepositoryRoot = process.cwd();
const contractPath = resolve(
  sourceRepositoryRoot,
  "benchmarks/search/lexical-linked-uplift-v1.json",
);
const stateRoot = resolve(sourceRepositoryRoot, ".lervo/state/search/lexical-linked-uplift-v1");
const statePath = resolve(stateRoot, "results.json");

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadContract() {
  const bytes = await readFile(contractPath);
  const contract = JSON.parse(bytes);
  assert(contract.schemaVersion === 1, "uplift_contract_schema_invalid");
  assert(contract.arms.join(",") === "lexical_only,lexical_plus_linked", "uplift_arms_invalid");
  assert(contract.repetitionsPerCase === 2, "uplift_repetitions_invalid");
  assert(contract.cases.length === 4, "uplift_case_count_invalid");
  return { contract, contractDigest: digest(bytes) };
}

function scheduleFor(contract) {
  const schedule = [];
  let pairOrdinal = 0;
  for (const sourceCase of contract.cases) {
    for (let repetition = 1; repetition <= contract.repetitionsPerCase; repetition += 1) {
      const providers = repetition % 2 === 1 ? ["codex", "claude"] : ["claude", "codex"];
      for (const provider of providers) {
        pairOrdinal += 1;
        const arms = pairOrdinal % 2 === 1 ? contract.arms : [...contract.arms].reverse();
        for (const arm of arms) {
          const coordinate = `${contract.benchmarkId}:${sourceCase.caseId}:${repetition}:${provider}:${arm}`;
          schedule.push({
            ordinal: schedule.length + 1,
            pairOrdinal,
            caseId: sourceCase.caseId,
            repetition,
            provider,
            model: contract.providers[provider],
            arm,
            runId: `run_${createHash("sha256").update(coordinate).digest("hex").slice(0, 32)}`,
            searchNonce: createHash("sha256")
              .update(`${coordinate}:search`)
              .digest("hex")
              .slice(0, 32),
            verificationSuiteId: "repository.default",
          });
        }
      }
    }
  }
  return schedule;
}

async function loadState(contractDigest, schedule) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert(state.contractDigest === contractDigest, "uplift_state_contract_stale");
    assert(
      state.scheduleDigest === digest(JSON.stringify(schedule)),
      "uplift_state_schedule_stale",
    );
    return state;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      benchmarkId: "lexical-linked-uplift-v1-20260830",
      contractDigest,
      scheduleDigest: digest(JSON.stringify(schedule)),
      createdAt: new Date().toISOString(),
      attempts: [],
      observations: [],
    };
  }
}

async function saveState(state) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function ratioDelta(control, treatment) {
  return control === null || treatment === null || control === 0
    ? null
    : (treatment - control) / control;
}

function summarizeRows(rows) {
  return {
    runs: rows.length,
    sourceRecall: mean(rows.map((row) => row.score.sourceRecall)),
    claimRecall: mean(rows.map((row) => row.score.claimRecall)),
    completeRate: mean(rows.map((row) => (row.score.complete ? 1 : 0))),
    durationMs: mean(rows.map((row) => row.durationMs)),
    inputTokens: mean(rows.map((row) => row.usage?.inputTokens)),
    cachedInputTokens: mean(rows.map((row) => row.usage?.cachedInputTokens)),
    outputTokens: mean(rows.map((row) => row.usage?.outputTokens)),
    totalTokens: mean(rows.map((row) => row.usage?.totalTokens)),
    appliedLinkedSourceBytes: mean(rows.map((row) => row.appliedLinkedSourceBytes)),
    estimatedAppliedLinkedTokens: mean(rows.map((row) => row.estimatedAppliedLinkedTokens)),
  };
}

function aggregate(contract, observations) {
  const byProvider = {};
  for (const provider of Object.keys(contract.providers)) {
    const control = summarizeRows(
      observations.filter((row) => row.provider === provider && row.arm === "lexical_only"),
    );
    const treatment = summarizeRows(
      observations.filter((row) => row.provider === provider && row.arm === "lexical_plus_linked"),
    );
    const pairs = [];
    for (const sourceCase of contract.cases) {
      for (let repetition = 1; repetition <= contract.repetitionsPerCase; repetition += 1) {
        const matching = observations.filter(
          (row) =>
            row.provider === provider &&
            row.caseId === sourceCase.caseId &&
            row.repetition === repetition,
        );
        const lexical = matching.find((row) => row.arm === "lexical_only");
        const linked = matching.find((row) => row.arm === "lexical_plus_linked");
        if (lexical === undefined || linked === undefined) continue;
        const lexicalQuality = (lexical.score.sourceRecall + lexical.score.claimRecall) / 2;
        const linkedQuality = (linked.score.sourceRecall + linked.score.claimRecall) / 2;
        pairs.push({
          caseId: sourceCase.caseId,
          repetition,
          qualityDelta: linkedQuality - lexicalQuality,
          durationDeltaMs: linked.durationMs - lexical.durationMs,
          inputTokenDelta:
            linked.usage?.inputTokens === undefined || lexical.usage?.inputTokens === undefined
              ? null
              : linked.usage.inputTokens - lexical.usage.inputTokens,
          totalTokenDelta:
            linked.usage?.totalTokens === undefined || lexical.usage?.totalTokens === undefined
              ? null
              : linked.usage.totalTokens - lexical.usage.totalTokens,
        });
      }
    }
    byProvider[provider] = {
      control,
      treatment,
      delta: {
        sourceRecallPoints: treatment.sourceRecall - control.sourceRecall,
        claimRecallPoints: treatment.claimRecall - control.claimRecall,
        completeRatePoints: treatment.completeRate - control.completeRate,
        durationRatio: ratioDelta(control.durationMs, treatment.durationMs),
        inputTokenRatio: ratioDelta(control.inputTokens, treatment.inputTokens),
        totalTokenRatio: ratioDelta(control.totalTokens, treatment.totalTokens),
        meanPairedQualityDelta: mean(pairs.map((pair) => pair.qualityDelta)),
        meanPairedDurationDeltaMs: mean(pairs.map((pair) => pair.durationDeltaMs)),
        meanPairedInputTokenDelta: mean(pairs.map((pair) => pair.inputTokenDelta)),
        meanPairedTotalTokenDelta: mean(pairs.map((pair) => pair.totalTokenDelta)),
        qualityWins: pairs.filter((pair) => pair.qualityDelta > 0).length,
        qualityTies: pairs.filter((pair) => pair.qualityDelta === 0).length,
        qualityLosses: pairs.filter((pair) => pair.qualityDelta < 0).length,
      },
      pairs,
    };
  }
  return {
    schemaVersion: 1,
    benchmarkId: contract.benchmarkId,
    completedRuns: observations.length,
    expectedRuns:
      contract.cases.length *
      contract.repetitionsPerCase *
      Object.keys(contract.providers).length *
      contract.arms.length,
    generatedAt: new Date().toISOString(),
    byProvider,
  };
}

async function main() {
  const command = process.argv[2] ?? "status";
  const { contract, contractDigest } = await loadContract();
  const schedule = scheduleFor(contract);
  const state = await loadState(contractDigest, schedule);
  if (command === "status") {
    console.log(
      JSON.stringify(
        {
          expectedRuns: schedule.length,
          attempts: state.attempts.length,
          completedRuns: state.observations.length,
          next: schedule.find(
            (run) => !state.observations.some((observation) => observation.runId === run.runId),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "report") {
    console.log(JSON.stringify(aggregate(contract, state.observations), null, 2));
    return;
  }
  assert(command === "execute", "usage: run-lexical-linked-uplift-v1.mjs status|execute|report");
  if (state.workspace === undefined) {
    state.workspace = await prepareLexicalLinkedUpliftWorkspace({
      repositoryRoot: sourceRepositoryRoot,
      stateRoot,
    });
    await saveState(state);
  }
  for (const run of schedule) {
    if (state.observations.some((observation) => observation.runId === run.runId)) continue;
    assert(
      !state.attempts.some((attempt) => attempt.runId === run.runId),
      `uplift_attempt_has_no_terminal_observation:${run.runId}`,
    );
    const observedAt = new Date().toISOString();
    state.attempts.push({ ...run, status: "started", observedAt });
    await saveState(state);
    const sourceCase = contract.cases.find((item) => item.caseId === run.caseId);
    console.log(
      JSON.stringify({
        event: "run.started",
        ordinal: run.ordinal,
        total: schedule.length,
        ...run,
      }),
    );
    try {
      const observation = await executeLexicalLinkedUpliftTask({
        repositoryRoot: state.workspace.workspaceRoot,
        sourceCase,
        ...run,
        observedAt,
      });
      state.observations.push(observation);
      state.attempts.find((attempt) => attempt.runId === run.runId).status = "completed";
      await saveState(state);
      console.log(
        JSON.stringify({
          event: "run.completed",
          ordinal: run.ordinal,
          provider: run.provider,
          arm: run.arm,
          durationMs: observation.durationMs,
          sourceRecall: observation.score.sourceRecall,
          claimRecall: observation.score.claimRecall,
          totalTokens: observation.usage?.totalTokens ?? null,
        }),
      );
    } catch (error) {
      const attempt = state.attempts.find((item) => item.runId === run.runId);
      attempt.status = "failed";
      attempt.failure = {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        evidence: error?.upliftEvidence ?? null,
      };
      await saveState(state);
      throw error;
    }
  }
  console.log(JSON.stringify(aggregate(contract, state.observations), null, 2));
}

await main();

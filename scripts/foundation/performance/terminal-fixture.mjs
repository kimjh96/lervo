import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  DisabledTerminalStageObservation,
  TerminalStageObservation,
  runCli,
} from "../../../apps/cli/dist/main.js";
import { createEventReaderCapabilities } from "../../../packages/event-contract/dist/index.js";
import {
  applyEventWriterActivationPlan,
  planEventWriterActivation,
} from "../../../packages/project/dist/index.js";
import { openProjectStorage } from "../../../packages/project-storage/dist/index.js";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
} from "../../../packages/repository-knowledge/dist/index.js";
import {
  createSearchQueryProjection,
  searchQueryProjectorBuildId,
} from "../../../packages/search/dist/index.js";

const projector = {
  id: "provider_query_projection.foundation_performance",
  version: 1,
  buildId: searchQueryProjectorBuildId("foundation-performance-terminal-v1"),
};

const profileSizes = { small: 8, medium: 64, large: 256 };
const fixtureMarker = "immutable cobalt benchmark envelope";
const privacySentinel = "private-performance-sentinel";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function projectedQueries(input) {
  return createSearchQueryProjection({
    projector,
    requestDigest: input.requestDigest,
    contextDigest: input.contextDigest,
    projectorResultDigest: sha256("foundation-performance-query-result-v1"),
    requestedLanguage: input.requestedLanguage,
    queries: [input.request],
    durationMs: 0,
    status: "completed",
  });
}

async function activateWriterV2(repositoryRoot) {
  const storage = await openProjectStorage(repositoryRoot);
  const projectId = storage.manifest.projectId;
  await storage.close();
  const plan = await planEventWriterActivation({
    repositoryRoot,
    evidence: {
      schemaVersion: 1,
      projectId,
      observedAt: "2026-09-01T00:00:00.000Z",
      readers: [
        {
          readerId: "reader_foundation_performance",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    },
  });
  if (plan.status !== "ready") throw new Error("The benchmark event writer is not ready.");
  await applyEventWriterActivationPlan({ plan, approval: plan.planId });
}

async function initializeTemplate(parent, repositoryProfile) {
  const documentCount = profileSizes[repositoryProfile];
  const root = resolve(parent, `template-${repositoryProfile}`);
  await mkdir(resolve(root, "docs"), { recursive: true });
  await writeFile(resolve(root, "README.md"), `# Benchmark fixture\n\n${fixtureMarker}.\n`);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Benchmark instructions\n\nUse exact repository knowledge before answering.\n",
  );
  for (let index = 0; index < documentCount; index += 1) {
    await writeFile(
      resolve(root, "docs", `benchmark-${String(index).padStart(4, "0")}.md`),
      `# Benchmark document ${index}\n\nDocument ${index} retains the ${fixtureMarker}.\n`,
    );
  }
  const silent = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  if ((await runCli(["init"], silent)) !== 0) throw new Error("Benchmark init failed.");
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(migration, new Date(), () => undefined);
  await activateWriterV2(root);
  const sourceFiles = [resolve(root, "README.md"), resolve(root, "AGENTS.md")];
  for (let index = 0; index < documentCount; index += 1) {
    sourceFiles.push(resolve(root, "docs", `benchmark-${String(index).padStart(4, "0")}.md`));
  }
  const repositoryByteCount = (await Promise.all(sourceFiles.map((path) => readFile(path)))).reduce(
    (total, content) => total + content.byteLength,
    0,
  );
  return {
    root,
    repositoryDocumentCount: sourceFiles.length,
    repositoryByteCount,
  };
}

async function invokeHook({ root, arm, profile, event, sessionId }) {
  const output = [];
  const errors = [];
  const input = {
    hook_event_name: event,
    session_id: sessionId,
    turn_id: `${sessionId}-turn`,
    ...(event === "UserPromptSubmit"
      ? { prompt: `${fixtureMarker}; ${privacySentinel}` }
      : { last_assistant_message: "Benchmark completion." }),
  };
  const exitCode = await runCli(
    ["terminal", "hook", "--provider", "codex", "--contract", "2"],
    {
      cwd: root,
      stdout: (message) => output.push(message),
      stderr: (message) => errors.push(message),
      stdin: async () => JSON.stringify(input),
    },
    {
      projectSearchQueries: async (request) => projectedQueries(request),
      createTerminalStageObservation: (buildDigest) =>
        arm === "candidate"
          ? new TerminalStageObservation(buildDigest, {
              ...profile.environment,
              lervoBuildDigest: buildDigest,
            })
          : new DisabledTerminalStageObservation(),
    },
  );
  return { exitCode, output: output.join(""), errors: errors.join("") };
}

async function latestStages(root, hookEvent) {
  const storage = await openProjectStorage(root);
  try {
    const events = [];
    let afterSeq = 0;
    while (true) {
      const page = storage.events.list({ afterSeq, limit: 1000 });
      if (page.length === 0) break;
      events.push(...page);
      afterSeq = page.at(-1).seq;
    }
    const event = events
      .filter(
        (item) =>
          item.type === "execution.stages.observed" && item.payload.terminalHook === hookEvent,
      )
      .at(-1);
    return event === undefined
      ? null
      : {
          eventId: event.eventId,
          environmentProfileDigest: event.payload.environmentProfileDigest,
          stages: Object.fromEntries(
            event.payload.stages.map((stage) => [stage.stageId, stage.durationMs]),
          ),
          coldStates: event.payload.stages.map((stage) => stage.coldState),
          serialized: JSON.stringify(event),
        };
  } finally {
    await storage.close();
  }
}

function boundedSession(profileId, arm, repetition, index) {
  return `perf-${profileId}-${arm}-${repetition}-${index}`;
}

export async function createTerminalPerformanceFixture(profiles) {
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-foundation-performance-"));
  const templates = new Map();
  const warmTemplates = new Map();
  for (const repositoryProfile of new Set(profiles.map((item) => item.repositoryProfile))) {
    const template = await initializeTemplate(parent, repositoryProfile);
    templates.set(repositoryProfile, template);
  }
  const warmProfiles = new Map();
  for (const profile of profiles.filter((item) => item.cacheState === "warm")) {
    if (!warmProfiles.has(profile.repositoryProfile)) {
      warmProfiles.set(profile.repositoryProfile, profile);
    }
  }
  for (const [repositoryProfile, profile] of warmProfiles) {
    const root = resolve(parent, `template-${repositoryProfile}-warm`);
    await cp(templates.get(repositoryProfile).root, root, { recursive: true });
    const warmed = await invokeHook({
      root,
      arm: "candidate",
      profile,
      event: "UserPromptSubmit",
      sessionId: `perf-warmup-${repositoryProfile}`,
    });
    if (warmed.exitCode !== 0 || !warmed.output.includes(fixtureMarker)) {
      throw new Error("The warm benchmark template could not be prepared.");
    }
    warmTemplates.set(repositoryProfile, root);
  }

  return {
    templates,
    async prepareSample({ profile, arm, repetition }) {
      const source =
        profile.cacheState === "warm"
          ? warmTemplates.get(profile.repositoryProfile)
          : templates.get(profile.repositoryProfile).root;
      const roots = [];
      for (let index = 0; index < profile.concurrency; index += 1) {
        const root = resolve(parent, `sample-${profile.profileId}-${arm}-${repetition}-${index}`);
        await cp(source, root, { recursive: true });
        roots.push(root);
      }
      const sessions = roots.map((_, index) =>
        boundedSession(profile.profileId, arm, repetition, index),
      );
      if (profile.hookEvent === "Stop") {
        await Promise.all(
          roots.map((root, index) =>
            invokeHook({
              root,
              arm: "baseline",
              profile,
              event: "UserPromptSubmit",
              sessionId: sessions[index],
            }),
          ),
        );
      }
      const beforeStageEventIds = await Promise.all(
        roots.map(async (root) => (await latestStages(root, profile.hookEvent))?.eventId ?? null),
      );
      return { roots, sessions, cleanupRoots: true, beforeStageEventIds };
    },
    async run({ profile, arm, fixture }) {
      const results = await Promise.all(
        fixture.roots.map((root, index) =>
          invokeHook({
            root,
            arm,
            profile,
            event: profile.hookEvent,
            sessionId: fixture.sessions[index],
          }),
        ),
      );
      const stageSets = await Promise.all(
        fixture.roots.map((root) => latestStages(root, profile.hookEvent)),
      );
      const expectedDigest = sha256(
        Buffer.from(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(profile.environment).sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        ),
      );
      const candidateStages = stageSets.filter(
        (item, index) => item !== null && item.eventId !== fixture.beforeStageEventIds[index],
      );
      const stages = {};
      for (const item of candidateStages) {
        for (const [stageId, durationMs] of Object.entries(item.stages)) {
          stages[stageId] = Math.max(stages[stageId] ?? 0, durationMs);
        }
      }
      const lifecycleCorrect = results.every((item) => {
        if (item.exitCode !== 0 || item.errors !== "") return false;
        if (profile.hookEvent === "Stop") return item.output.trim() === "{}";
        try {
          return JSON.parse(item.output).hookSpecificOutput.hookEventName === "UserPromptSubmit";
        } catch {
          return false;
        }
      });
      const retrievalCorrect =
        profile.hookEvent === "Stop" ||
        results.every((item) => item.output.includes(fixtureMarker));
      const privacyCorrect = candidateStages.every(
        (item) =>
          item.environmentProfileDigest === expectedDigest &&
          item.coldStates.every((state) => state === profile.cacheState) &&
          !item.serialized.includes(privacySentinel) &&
          !fixture.roots.some((root) => item.serialized.includes(root)),
      );
      const telemetryCorrect =
        arm === "candidate"
          ? candidateStages.length === fixture.roots.length &&
            stageSets.every((item) => item !== null)
          : candidateStages.length === 0 &&
            stageSets.every(
              (item, index) => (item?.eventId ?? null) === fixture.beforeStageEventIds[index],
            );
      return {
        outcome: lifecycleCorrect && telemetryCorrect ? "completed" : "failed",
        stages,
        retrievalCorrect,
        lifecycleCorrect,
        privacyCorrect: privacyCorrect && telemetryCorrect,
      };
    },
    async cleanupSample(fixture) {
      if (fixture.cleanupRoots) {
        await Promise.all(fixture.roots.map((root) => rm(root, { recursive: true, force: true })));
      }
    },
    async close() {
      await rm(parent, { recursive: true, force: true });
    },
  };
}

export const terminalFixtureProfileSizes = profileSizes;

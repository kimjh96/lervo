import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadProjectManifest } from "../../packages/project/dist/index.js";
import { stringify } from "yaml";

import {
  loadDelegatedRetrievalCorpus,
  observeRepositorySnapshot,
} from "./delegated-retrieval-workspace.mjs";
import {
  createPhaseAPilotSchedule,
  loadPhaseAPilotContract,
  sha256,
  valueDigest,
} from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { projectPhaseAPilotSchedule } from "./linked-evidence-shadow-phase-a-pilot-projection.mjs";

const verifiedAt = "2026-08-28T00:00:00.000Z";

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    encoding: "utf8",
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...options,
  });
  return result.trim();
}

async function ownerFile(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function pilotAgentInstructions(source) {
  return [
    "# Isolated phase-A pilot instructions",
    "",
    "This repository is an isolated, deletable linked-evidence shadow pilot.",
    "For each managed request, inspect the supplied repository sources and write the concise answer only to the single declared pilot-output file.",
    "Do not change source documents, manifests, policies, verification suites, or lifecycle state.",
    "",
    source,
  ].join("\n");
}

function documentManifest(source, revision) {
  return {
    schemaVersion: 1,
    documentId: source.sourceId,
    record: {
      path: source.path,
      kind: "canonical",
      responsibleParty: { kind: "team", id: "phase-a-pilot-reviewers" },
      connectedPaths: [source.path],
      verifiedRevision: revision,
      verifiedAt,
      reviewIntervalDays: 1,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "phase-a-pilot.en/v1",
      locale: "en",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

function verificationSource(runSpec) {
  const assertion = `const fs=require('node:fs');const p=${JSON.stringify(runSpec.targetPath)};process.exit(fs.existsSync(p)&&fs.statSync(p).size>0?0:1)`;
  return [
    "schemaVersion: 1",
    `suiteId: ${runSpec.verificationSuiteId}`,
    "stopOnFailure: true",
    "commands:",
    `  - commandId: verify-output-${String(runSpec.ordinal).padStart(2, "0")}`,
    "    executable: node",
    "    arguments:",
    "      - -e",
    `      - ${JSON.stringify(assertion)}`,
    "    cwd: .",
    "    timeoutMs: 10000",
    "    maxOutputBytes: 4096",
    "    environmentVariableNames: []",
    "",
  ].join("\n");
}

async function startPilotWorkstream(cliEntry, pilotRoot, contract, preparedContractDigest) {
  const draft = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: `Linked-evidence shadow phase-A registered-corpus pilot ${contract.schemaVersion}`,
    objective: "Collect the reviewed 30-run immutable local shadow observation set.",
    nextActions: ["Execute the exact prepared schedule.", "Replay and review every observation."],
    blockers: [],
    notes: [`Pilot contract: ${preparedContractDigest}`],
    references: [
      {
        path: "docs/decisions/search/0248-stage-linked-evidence-reconciliation-activation.md",
        label: "ADR-0248",
      },
      {
        path:
          contract.decisionPath ??
          "docs/decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md",
        label: contract.decisionId,
      },
    ],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: verifiedAt,
  });
  const plan = JSON.parse(
    run(
      process.execPath,
      [
        cliEntry,
        "workstream",
        "start",
        "--stdin",
        "--actor",
        "agent",
        "--provider",
        "codex",
        "--root",
        pilotRoot,
        "--json",
      ],
      { input: draft },
    ),
  );
  run(
    process.execPath,
    [
      cliEntry,
      "workstream",
      "start",
      "--stdin",
      "--actor",
      "agent",
      "--provider",
      "codex",
      "--root",
      pilotRoot,
      "--apply",
      plan.planId,
      "--json",
    ],
    { input: draft },
  );
}

export function phaseAPilotPaths(repositoryRoot, pilotId) {
  const pilotsRoot = resolve(repositoryRoot, ".lervo/state/search/linked-evidence-shadow-pilots");
  const root = resolve(pilotsRoot, pilotId);
  return {
    pilotsRoot,
    root,
    repository: resolve(root, "repository"),
    controller: resolve(root, "controller"),
    prepared: resolve(root, "controller/prepared.json"),
    receipts: resolve(root, "controller/run-receipts.json"),
    review: resolve(root, "controller/review.json"),
  };
}

export async function preparePhaseAPilot(repositoryRoot, contractPath) {
  const loaded = await loadPhaseAPilotContract(repositoryRoot, contractPath);
  const paths = phaseAPilotPaths(repositoryRoot, loaded.contract.pilotId);
  await mkdir(paths.pilotsRoot, { recursive: true, mode: 0o700 });
  const existing = await readdir(paths.pilotsRoot);
  if (existing.includes(loaded.contract.pilotId))
    throw new Error("This phase-A pilot already exists; derived state was preserved.");
  if (existing.length >= loaded.contract.retention.maximumPilots)
    throw new Error("The reviewed phase-A pilot retention bound is already full.");
  await mkdir(paths.repository, { recursive: true, mode: 0o700 });
  const cliEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");
  run("git", ["init", "--quiet"], { cwd: paths.repository });
  run(process.execPath, [
    cliEntry,
    "init",
    "--root",
    paths.repository,
    "--name",
    "linked-evidence-shadow-phase-a-pilot",
    "--json",
  ]);

  const snapshot = observeRepositorySnapshot(repositoryRoot);
  const revision = `${snapshot.head}:${snapshot.workingTreeStatusDigest}`;
  const schedule = createPhaseAPilotSchedule(loaded.contract, loaded.suite);
  const sourceCorpus = await loadDelegatedRetrievalCorpus(repositoryRoot, loaded.suite);
  for (const source of sourceCorpus) {
    const text = source.path === "AGENTS.md" ? pilotAgentInstructions(source.text) : source.text;
    await ownerFile(resolve(paths.repository, source.path), text);
    const registered = { ...source, text, contentHash: sha256(text) };
    await ownerFile(
      resolve(paths.repository, ".lervo/documents", `${source.sourceId}.yaml`),
      stringify(documentManifest(registered, revision), { lineWidth: 0, sortMapEntries: true }),
    );
  }
  for (const runSpec of schedule) {
    await ownerFile(
      resolve(paths.repository, ".lervo/verifications", `${runSpec.verificationSuiteId}.yaml`),
      verificationSource(runSpec),
    );
  }
  run("git", ["add", "."], { cwd: paths.repository });
  run(
    "git",
    [
      "-c",
      "user.name=Lervo Phase A",
      "-c",
      "user.email=phase-a@lervo.invalid",
      "commit",
      "--quiet",
      "-m",
      "chore: prepare isolated phase-a pilot",
    ],
    { cwd: paths.repository },
  );
  await startPilotWorkstream(cliEntry, paths.repository, loaded.contract, loaded.contractDigest);
  const project = await loadProjectManifest(paths.repository);
  const corpus = await (
    await import("../../packages/search-local/dist/index.js")
  ).loadRegisteredDocumentCorpus(paths.repository);
  const projections = await projectPhaseAPilotSchedule({
    pilotRoot: paths.repository,
    projectId: project.projectId,
    schedule,
  });
  const nonemptyProjectionCount = projections.filter((item) => item.retainedCount > 0).length;
  if (nonemptyProjectionCount < loaded.contract.shadowGate.minimumNonemptyProjections) {
    throw new Error(
      "The isolated registered corpus cannot meet the pre-registered incidence gate.",
    );
  }
  const manifest = {
    schemaVersion: 1,
    pilotId: loaded.contract.pilotId,
    preparedAt: new Date().toISOString(),
    projectId: project.projectId,
    contractDigest: loaded.contractDigest,
    sourceSuiteDigest: loaded.contract.sourceSuiteDigest,
    cliDigest: sha256(await readFile(cliEntry)),
    sourceSnapshot: snapshot,
    corpusDigest: valueDigest(
      corpus.map(({ sourceId, path, contentHash }) => ({
        documentId: sourceId,
        path,
        contentHash,
      })),
    ),
    corpus: corpus.map(({ sourceId, path, contentHash }) => ({
      documentId: sourceId,
      path,
      contentHash,
    })),
    schedule,
    dryRunProjections: projections,
    nonemptyProjectionCount,
    providerCalls: 0,
  };
  const envelope = { manifest, manifestDigest: valueDigest(manifest) };
  await ownerFile(paths.prepared, `${JSON.stringify(envelope, null, 2)}\n`);
  if (process.platform !== "win32" && ((await stat(paths.prepared)).mode & 0o777) !== 0o600) {
    throw new Error("The prepared pilot manifest is not owner-only.");
  }
  return { paths, ...envelope };
}

export async function loadPreparedPhaseAPilot(repositoryRoot, contractPath) {
  const loaded = await loadPhaseAPilotContract(repositoryRoot, contractPath);
  const paths = phaseAPilotPaths(repositoryRoot, loaded.contract.pilotId);
  const envelope = JSON.parse(await readFile(paths.prepared, "utf8"));
  if (
    valueDigest(envelope.manifest) !== envelope.manifestDigest ||
    envelope.manifest.contractDigest !== loaded.contractDigest
  ) {
    throw new Error("The prepared phase-A pilot manifest binding is invalid.");
  }
  const cliEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");
  if (sha256(await readFile(cliEntry)) !== envelope.manifest.cliDigest) {
    throw new Error("The built CLI changed after phase-A pilot preparation.");
  }
  if (
    valueDigest(observeRepositorySnapshot(repositoryRoot)) !==
    valueDigest(envelope.manifest.sourceSnapshot)
  ) {
    throw new Error("The source repository changed after phase-A pilot preparation.");
  }
  const corpus = await (
    await import("../../packages/search-local/dist/index.js")
  ).loadRegisteredDocumentCorpus(paths.repository);
  const corpusDigest = valueDigest(
    corpus.map(({ sourceId, path, contentHash }) => ({ documentId: sourceId, path, contentHash })),
  );
  if (corpusDigest !== envelope.manifest.corpusDigest)
    throw new Error("The prepared pilot corpus drifted.");
  return { loaded, paths, ...envelope };
}

import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stringify } from "yaml";

import { loadDelegatedRetrievalCorpus } from "./delegated-retrieval-workspace.mjs";
import { repositoryStatusDigest } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";

const verifiedAt = "2026-08-30T00:00:00.000Z";

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    encoding: "utf8",
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...options,
  }).trim();
}

async function ownerFile(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function documentManifest(source, revision) {
  return {
    schemaVersion: 1,
    documentId: source.sourceId,
    record: {
      path: source.path,
      kind: "canonical",
      responsibleParty: { kind: "team", id: "uplift-reviewers" },
      connectedPaths: [source.path],
      verifiedRevision: revision,
      verifiedAt,
      reviewIntervalDays: 1,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "lexical-linked-uplift.en/v1",
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

export async function prepareLexicalLinkedUpliftWorkspace(input) {
  const workspaceRoot = resolve(input.stateRoot, "repository");
  await mkdir(workspaceRoot, { recursive: false, mode: 0o700 });
  const cliEntry = resolve(input.repositoryRoot, "apps/cli/dist/bin.js");
  run("git", ["init", "--quiet"], { cwd: workspaceRoot });
  run(process.execPath, [
    cliEntry,
    "init",
    "--root",
    workspaceRoot,
    "--name",
    "lexical-linked-uplift-v1",
    "--json",
  ]);
  const sourceSuite = JSON.parse(
    await readFile(
      resolve(input.repositoryRoot, "benchmarks/search/linked-evidence-reconciliation-v8.json"),
      "utf8",
    ),
  );
  const sourceCorpus = await loadDelegatedRetrievalCorpus(input.repositoryRoot, sourceSuite);
  const revision = repositoryStatusDigest(input.repositoryRoot);
  for (const source of sourceCorpus) {
    await ownerFile(resolve(workspaceRoot, source.path), source.text);
    await ownerFile(
      resolve(workspaceRoot, ".lervo/documents", `${source.sourceId}.yaml`),
      stringify(documentManifest(source, revision), { lineWidth: 0, sortMapEntries: true }),
    );
  }
  await ownerFile(
    resolve(workspaceRoot, ".lervo/verifications/repository.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: repository.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-read-only",
      "    executable: node",
      "    arguments:",
      "      - -e",
      '      - "process.exit(0)"',
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  await ownerFile(
    resolve(workspaceRoot, ".lervo/roles/canary-researcher.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "lervo_repository_role",
        roleId: "canary-researcher",
        version: "1.0.0",
        extends: [{ roleId: "developer", version: "1.0.0" }],
        profile: {
          name: "Canary Researcher",
          description:
            "Produces a machine-facing read-only evidence answer for a paired context evaluation.",
          requestTypes: ["research"],
          capabilities: {
            "filesystem.read": "allow",
            "filesystem.write": "deny",
            "shell.execute": "deny",
            "network.access": "deny",
            "external.message": "deny",
            deploy: "deny",
            "data.mutate": "deny",
          },
        },
        checks: [],
      },
      null,
      2,
    )}\n`,
  );
  run("git", ["add", "."], { cwd: workspaceRoot });
  run(
    "git",
    [
      "-c",
      "user.name=Lervo Uplift",
      "-c",
      "user.email=uplift@lervo.invalid",
      "commit",
      "--quiet",
      "-m",
      "chore: prepare current registered uplift corpus",
    ],
    { cwd: workspaceRoot },
  );
  const registry = await (
    await import("../../packages/project/dist/index.js")
  ).loadDocumentRegistry(workspaceRoot);
  return {
    workspaceRoot,
    registeredDocumentCount: Object.keys(registry.documents).length,
    sourceRepositoryStatusDigest: revision,
    workspaceStatusDigest: repositoryStatusDigest(workspaceRoot),
  };
}

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileSystemCas } from "@lervo/cas";
import { canonicalJson } from "@lervo/event-contract";
import {
  getBuiltInRoleDefinition,
  prepareResearchInputs,
  researchContractHash,
} from "@lervo/roles";
import { runResearchCommand } from "../src/research-command.js";
import { prepareResearchVerificationEnvironment } from "../src/research-verification-environment.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("verifies actual captured source and result bytes and fails a different result or input hash", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-research-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/research"), { recursive: true });
  const projectId = "prj_" + "a".repeat(16);
  await writeFile(
    resolve(root, ".lervo/research/source-policy.json"),
    canonicalJson({
      schemaVersion: 1,
      kind: "research.source_policy",
      policyId: "repository.sources",
      version: 1,
      projectId,
      allowedPaths: ["README.md"],
      maximumSources: 1,
      maximumSourceBytes: 4096,
      maximumAgeMs: 60000,
      allowNetwork: false,
    }),
  );
  await writeFile(resolve(root, "README.md"), "Local execution works without a Hub.\n");
  const now = () => "2026-09-12T08:00:00.000Z";
  const captured = await prepareResearchInputs({
    repositoryRoot: root,
    projectId,
    researchQuestion: "Does local execution require a Hub?",
    role: getBuiltInRoleDefinition("researcher").profile,
    roleContractHash: researchContractHash("role"),
    now,
  });
  const casRoot = resolve(root, "cas");
  const cas = await FileSystemCas.open(casRoot);
  await cas.put(canonicalJson(captured.inputs));
  const source = captured.inputs.sources[0]!;
  const manifest = {
    schemaVersion: 1,
    kind: "research.brief",
    inputHash: captured.inputHash,
    sources: [
      {
        sourceId: source.sourceId,
        url: source.url,
        retrievedAt: source.retrievedAt,
        contentHash: source.contentHash,
      },
    ],
  };
  const result = await cas.put(
    `Local execution works without a Hub.[^S1]\n\n[^S1]: ${source.url}\n\n<!-- lervo-research ${canonicalJson(manifest)} -->`,
  );
  let output = "";
  let error = "";
  const io = {
    cwd: root,
    stdout: (value: string) => {
      output += value;
    },
    stderr: (value: string) => {
      error += value;
    },
  };
  const environment = {
    LERVO_RESEARCH_CAS_ROOT: casRoot,
    LERVO_RESEARCH_INPUT_HASH: captured.inputHash,
    LERVO_RESEARCH_ARTIFACT_HASH: result.contentHash,
  };
  expect(await runResearchCommand(["verify", "--json"], io, environment, now)).toBe(0);
  expect(JSON.parse(output)).toMatchObject({
    status: "passed",
    inputHash: captured.inputHash,
    resultContentHash: result.contentHash,
  });
  expect(output).not.toContain(source.text);
  expect(error).toBe("");
  const invented = await cas.put("An unsupported claim with no provenance.");
  expect(
    await runResearchCommand(
      ["verify"],
      io,
      { ...environment, LERVO_RESEARCH_ARTIFACT_HASH: invented.contentHash },
      now,
    ),
  ).toBe(1);
  expect(
    await runResearchCommand(
      ["verify"],
      io,
      { ...environment, LERVO_RESEARCH_INPUT_HASH: researchContractHash("missing") },
      now,
    ),
  ).toBe(1);
});

it("rejects a successful placeholder command and binds the checker environment to explicit coordinates", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-research-checker-"));
  roots.push(root);
  const cli = resolve(root, "bin.js");
  await writeFile(cli, "// bounded checker fixture\n");
  const suite = {
    schemaVersion: 1 as const,
    suiteId: "role.research.artifact",
    stopOnFailure: true as const,
    commands: [
      {
        commandId: "research-artifact",
        executable: "node",
        arguments: [cli, "research", "verify", "--json"],
        cwd: ".",
        timeoutMs: 1000,
        maxOutputBytes: 4096,
        environmentVariableNames: [
          "LERVO_RESEARCH_ARTIFACT_HASH",
          "LERVO_RESEARCH_CAS_ROOT",
          "LERVO_RESEARCH_INPUT_HASH",
        ],
      },
    ],
  };
  const input = {
    suite,
    inputArtifactHash: researchContractHash("inputs"),
    casRoot: resolve(root, "cas"),
    cliModuleUrl: new URL(`file://${cli}`).href,
    nodeExecutable: "/runtime/node",
  };
  expect(await prepareResearchVerificationEnvironment(input)).toEqual({
    PATH: "/runtime",
    LERVO_RESEARCH_INPUT_HASH: input.inputArtifactHash,
    LERVO_RESEARCH_CAS_ROOT: input.casRoot,
  });
  await expect(
    prepareResearchVerificationEnvironment({
      ...input,
      suite: { ...suite, commands: [{ ...suite.commands[0]!, arguments: ["--version"] }] },
    }),
  ).rejects.toThrow(/exact installed CLI/iu);
});

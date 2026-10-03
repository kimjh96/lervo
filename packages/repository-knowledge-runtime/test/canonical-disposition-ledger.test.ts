import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { settledCanonicalDispositions } from "../src/canonical-disposition-ledger.js";
import { convergenceDelegationPlanHash } from "../src/delegation.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function boundedFixture() {
  const f = await fixture(true);
  fixtures.push(f);
  await mkdir(resolve(f.root, "src"));
  for (let i = 0; i < 4; i++)
    await writeFile(resolve(f.root, "src", `${i}.ts`), `export const source${i} = ${i};\n`);
  const { review, ...previous } = f.delegation!;
  const plan = {
    ...previous,
    resourceCeilings: { ...previous.resourceCeilings, maximumDocuments: 2 },
  };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify({
      ...plan,
      review: { ...review, planHash: convergenceDelegationPlanHash(plan) },
    }),
  );
  return f;
}

const integrations = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.events
    .list({ limit: 1_000 })
    .filter(
      (event) =>
        event.type === "repository.knowledge.stage.recorded" &&
        event.payload.stage === "canonical_integration" &&
        event.payload.state === "current",
    );

async function assessedSources(log: string) {
  return (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          request: {
            task: string;
            untrustedSourceData: { sources?: { path: string; contentHash: string }[] };
          };
        },
    )
    .filter((call) => call.request.task === "canonical_baseline_assessment")
    .flatMap((call) => call.request.untrustedSourceData.sources ?? [])
    .map((source) => `${source.path}@${source.contentHash}`);
}

it(
  "keeps integrated dispositions across source supersession and reaches currency without reassessment",
  { timeout: 300_000 },
  async () => {
    const f = await boundedFixture();
    for (let cycle = 0; cycle < 12 && integrations(f).length === 0; cycle++)
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `ledger-${cycle}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
    expect(integrations(f)).toHaveLength(1);
    const settledBefore = await assessedSources(f.log);
    expect(settledBefore.length).toBeGreaterThan(0);

    // An unrelated concurrent edit supersedes the unfinished baseline.
    await writeFile(resolve(f.root, "src", "late.ts"), "export const late = true;\n");
    const successor = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
    const settledPaths = successor.settledAssessments!.map((item) => item.path);
    expect(settledPaths.length).toBe(settledBefore.length);
    expect(successor.settledAssessments!.every((item) => item.eventId)).toBe(true);
    expect(successor.assessmentPaths).toContain("src/late.ts");
    expect(successor.assessmentPaths!.some((path) => settledPaths.includes(path))).toBe(false);

    let result;
    for (let i = 0; i < 12; i++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `ledger-final-${i}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency !== null) break;
    }
    expect(await inspectAutonomousKnowledgeStatus(f.storage)).toMatchObject({
      baselineCurrent: true,
    });
    const assessed = await assessedSources(f.log);
    expect(new Set(assessed).size).toBe(assessed.length);
    expect(f.events.list({ limit: 1_000 }).map((event) => event.payload.terminalState)).toContain(
      "superseded",
    );

    // Changed bytes leave the ledger and return to provider review.
    await writeFile(resolve(f.root, settledPaths[0]!), "export const changed = true;\n");
    const changed = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
    expect(changed.assessmentPaths).toContain(settledPaths[0]);
  },
);

it(
  "keeps coverage settled only while its exact quoted canonical passage remains",
  { timeout: 300_000 },
  async () => {
    const f = await boundedFixture();
    for (let cycle = 0; cycle < 12 && integrations(f).length === 0; cycle++)
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `coverage-${cycle}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
    const [integrated] = integrations(f);
    expect(integrated).toBeDefined();
    const hash = integrated!.payload.inputArtifactHash as string;
    const prior = JSON.parse(
      Buffer.from(await f.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`)).toString("utf8"),
    ) as KnowledgeConvergenceInput;
    const batch = prior.stageData.canonicalBatch as {
      sources: { path: string; contentHash: string }[];
      assessment: { decisions: Record<string, unknown>[]; drafts: unknown[] };
    };
    const quote = "The runtime works locally without a Hub.";
    const assessment = {
      ...batch.assessment,
      decisions: batch.assessment.decisions.map((decision) => ({
        ...decision,
        disposition: "covered",
        canonicalReferences: [{ path: "docs/specs/runtime.md", contentHash: "sha256:any", quote }],
      })),
    };
    const covered = await f.artifacts.put(
      canonicalJson({
        ...prior,
        stageData: {
          ...prior.stageData,
          canonicalBatch: { ...batch, assessment },
          canonicalApproval: {
            ...(prior.stageData.canonicalApproval as object),
            assessmentHash: sha256(canonicalJson(assessment)),
          },
        },
      }),
    );
    f.events.append({
      eventId: "evt_ledger_covered_fixture",
      projectId: integrated!.projectId,
      runId: integrated!.runId,
      sessionId: integrated!.sessionId,
      actor: integrated!.actor,
      schemaVersion: 4,
      policyVersion: integrated!.policyVersion,
      type: "repository.knowledge.stage.recorded",
      occurredAt: new Date().toISOString(),
      payload: { ...integrated!.payload, inputArtifactHash: covered.contentHash },
    });
    const lookup = () =>
      settledCanonicalDispositions({
        repositoryRoot: f.root,
        events: f.events,
        artifacts: f.artifacts,
        projectId: prior.baseline.projectId,
        policyHash: prior.baseline.policyHash,
        sources: batch.sources,
      });
    expect((await lookup()).map((item) => item.disposition)).toEqual(
      batch.sources.map(() => "covered"),
    );
    // Unrelated canonical edits keep coverage; removing the quoted passage does not.
    await writeFile(
      resolve(f.root, "docs/specs/runtime.md"),
      `# Runtime\n\n${quote}\n\nA later unrelated paragraph.\n`,
    );
    expect(await lookup()).toHaveLength(batch.sources.length);
    await writeFile(resolve(f.root, "docs/specs/runtime.md"), "# Runtime\n\nRewritten.\n");
    expect(await lookup()).toEqual([]);
    expect(
      await settledCanonicalDispositions({
        repositoryRoot: f.root,
        events: f.events,
        artifacts: f.artifacts,
        projectId: prior.baseline.projectId,
        policyHash: "sha256:changed",
        sources: batch.sources,
      }),
    ).toEqual([]);
  },
);

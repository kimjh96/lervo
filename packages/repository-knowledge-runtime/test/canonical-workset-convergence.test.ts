import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./fixture.js";
import { convergenceDelegationPlanHash } from "../src/delegation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "independently reviews every small canonical workset and reaches full currency without skipped sources",
  { timeout: 240_000 },
  async () => {
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
    let result;
    for (let i = 0; i < 8; i++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `bounded-${i}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency !== null) break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: {
        state: "idle",
        lastVerifiedCurrency: expect.any(Object),
      },
    });
    expect(await inspectAutonomousKnowledgeStatus(f.storage)).toMatchObject({
      baselineCurrent: true,
    });
    const baselineEvent = f.events
      .list({ limit: 1000 })
      .find((event) => event.type === "repository.knowledge.baseline.requested")!;
    const initial = JSON.parse(
      Buffer.from(
        await f.artifacts.get(
          `lervo-cas://sha256/${String(baselineEvent.payload.inputArtifactHash).slice(7)}`,
        ),
      ).toString("utf8"),
    );
    const expected = initial.baseline.sources
      .filter(
        (source: { path: string; kind: string }) =>
          source.kind === "text" &&
          initial.baseline.sourceDispositions.find(
            (item: { path: string }) => item.path === source.path,
          )?.kind === "semantic_source",
      )
      .map((source: { path: string }) => source.path);
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const assessments = calls.filter(
      (call) => call.request.task === "canonical_baseline_assessment",
    );
    expect(assessments.length).toBeGreaterThan(1);
    expect(assessments.every((call) => call.request.untrustedSourceData.sources.length <= 2)).toBe(
      true,
    );
    expect(
      assessments
        .flatMap((call) =>
          call.request.untrustedSourceData.sources.map((source: { path: string }) => source.path),
        )
        .sort(),
    ).toEqual(expected.sort());
    expect(
      calls.filter((call) => call.request.task === "independent_canonical_review"),
    ).toHaveLength(assessments.length);
    const before = await readFile(f.log, "utf8");
    await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "idle",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    expect(await readFile(f.log, "utf8")).toBe(before);
  },
);

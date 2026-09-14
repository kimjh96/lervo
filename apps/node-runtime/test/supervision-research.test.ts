import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { researchAcceptanceFixture } from "./supervision-research.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["passed", "failed"] as const)(
  "requires exact researcher inputs, real checker output and independent semantic judgement (%s)",
  async (verdict) => {
    const f = await researchAcceptanceFixture(roots);
    const { cliBundle } = f;
    const log = resolve(f.login.context.homeDirectory, "research-operations.log");
    const login = (await readFile(f.login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let provider = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    ).replace(/^#![^\n]*\n/u, "");
    provider = provider.replace(
      "function completeTurn(content) {",
      `function completeTurn(content) {
    send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});`,
    );
    provider = provider.replace(
      "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
      `
    if(instructions.includes("Act as the registered product owner.")) {
      const context=JSON.parse(instructions.slice(instructions.lastIndexOf("\\n\\n")+2));
      const task=context.facts.tasks.assignments[0];
      const details={assignmentId:task.assignmentId,resultContentHash:task.artifactHashes[0],writingPolicyId:context.facts.writingContract.writingPolicyId,
        checks:context.facts.writingContract.verification.semanticChecks.filter(item=>item.required).map(item=>({checkId:item.checkId,status:"passed",violationCount:0})),
        researchChecks:[{checkId:"research.citation-integrity",status:"${verdict}"},{checkId:"research.claim-support",status:"${verdict}"}]};
      await appendFile(${JSON.stringify(log)},"independent-review\\n");
      completeTurn(JSON.stringify({schemaVersion:1,operation:"prepare_completion",rationale:"The independent fixture compared the exact captured source to the returned claim.",details:JSON.stringify(details)}));return;
    }
    if(instructions.includes("Exact prepared research inputs: ")) {
      const inputs=JSON.parse(instructions.split("Exact prepared research inputs: ")[1].split("\\n\\n")[0]);
      const template=JSON.parse(instructions.split("Provenance comment format: <!-- lervo-research ")[1].split(" -->")[0]);
      const source=inputs.sources[0];
      await appendFile(${JSON.stringify(log)},"research-worker\\n");
      completeTurn("The source exports saved as ${verdict === "passed" ? "true. This establishes the literal value in this file; runtime persistence is unverified" : "false and proves durable persistence across restart"}.[^S1]\\n\\n[^S1]: "+source.url+"\\n\\n<!-- lervo-research "+JSON.stringify(template)+" -->");return;
    }
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
    );
    await writeFile(
      f.login.executable,
      `${login}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\n${provider}`,
    );
    const storage = await openProjectStorage(f.root);
    const openRuntime = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: { now: f.ports.now, recordAttention: f.ports.recordAttention },
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: f.runtimeReadiness,
        managedExecution: { nodeExecutable: process.execPath, cliBundle },
      });
    let runtime = await openRuntime();
    try {
      const cycles = [];
      for (let index = 0; index < 3; index++) {
        cycles.push(await runtime.runCycle());
        expect(cycles.at(-1)?.disposition, JSON.stringify({ cycles, attention: f.attention })).toBe(
          "effect_confirmed",
        );
        if (index === 1) {
          await runtime.close();
          runtime = await openRuntime();
        }
      }
      const events = storage.events.list({ limit: 1000 });
      expect(events.filter((event) => event.type === "role.input.bound")).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.type === "verification.completed" &&
            event.payload.suiteId === "role.research.artifact",
        ),
      ).toMatchObject([{ payload: { status: "passed" } }]);
      expect(await readFile(log, "utf8")).toBe("research-worker\nindependent-review\n");
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
      if (verdict === "failed") {
        expect(await listAssignments(f.root)).toMatchObject([{ status: "leased" }]);
        expect(events.filter((event) => event.type === "assignment.completion.prepared")).toEqual(
          [],
        );
        expect(
          events.filter((event) => event.type === "work.supervision.review.recorded"),
        ).toMatchObject([{ payload: { verdict: "rework" } }]);
      } else {
        expect(await listAssignments(f.root)).toMatchObject([{ status: "completed" }]);
        const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
        const { facts } = await canonicalOwnerReasoningFacts(
          storage,
          f.binding,
          source,
          f.ports.now,
        );
        expect(facts.researchEvidence).toMatchObject([
          {
            assignmentId: f.assignment.assignmentId,
            resultContentHash: source.events.find(
              (event) =>
                event.runId === source.execution.attempts[0]?.runId &&
                event.type === "run.completed",
            )?.payload.resultDigest,
            verificationEventId: events.find((event) => event.type === "verification.completed")
              ?.eventId,
            verificationReport: { status: "passed" },
            recordedExecutionBoundary: {
              executionMode: "read_only",
              capabilities: { fileChanges: "unsupported" },
            },
            capturedSourceMeasurements: [
              {
                path: "src/save.ts",
                byteCount: Buffer.byteLength("export const saved = true;\n"),
                maximumSourceBytes: 4096,
              },
            ],
            currentSourceContinuity: [{ path: "src/save.ts", matchesCapturedNow: true }],
          },
        ]);
        const completedEvidence = facts.researchEvidence[0];
        if (!completedEvidence || !("capturedSourceMeasurements" in completedEvidence))
          throw new Error("Completed research review evidence is missing.");
        const measurements = completedEvidence.capturedSourceMeasurements;
        if (!Array.isArray(measurements))
          throw new Error("Completed research source measurements are missing.");
        expect(measurements[0]?.measuredContentHash).toBe(measurements[0]?.contentHash);
        const plans = await Promise.all(
          events
            .filter((event) => event.type === "work.supervision.decision.recorded")
            .map((event) =>
              readSupervisionJsonArtifact(storage.artifacts, String(event.payload.planHash)),
            ),
        );
        const plan = plans.find(
          (value) =>
            (value as { effectContract: string }).effectContract ===
            "work.assignment_completion.v2",
        ) as { effectHash: string };
        expect(plan).toBeDefined();
        const effect = (await readSupervisionJsonArtifact(storage.artifacts, plan.effectHash)) as {
          roleEvaluationArtifactHash: string;
        };
        const evaluation = (await readSupervisionJsonArtifact(
          storage.artifacts,
          effect.roleEvaluationArtifactHash,
        )) as {
          overallStatus: string;
          producerRunId: string;
          checks: { method: string; evaluatorRunId: string | null }[];
        };
        expect(evaluation.overallStatus).toBe("passed");
        for (const check of evaluation.checks.filter((item) => item.method === "separate_semantic"))
          expect(check.evaluatorRunId).not.toBe(evaluation.producerRunId);
      }
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  60000,
);

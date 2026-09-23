import { execFile } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { readReusableOwnerDecision } from "../src/supervision-reasoning-history.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([true, false])(
  "reconciles stopped native owner failure and retries only with observed usage (%s)",
  async (reportUsage) => {
    const login = await createLoginFixture(roots);
    const f = await supervisionFixture(
      roots,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Inspect existing evidence and preserve the original goal.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        for (const args of [
          ["init"],
          ["config", "user.name", "Lervo Test"],
          ["config", "user.email", "test@example.invalid"],
          ["add", "AGENTS.md"],
          ["commit", "-m", "fixture"],
        ])
          await promisify(execFile)("git", ["-C", root, ...args]);
      },
      "developer",
      ["allocate_existing", "execute_as_owner"],
    );
    const log = resolve(login.context.homeDirectory, "owner-invocations.log");
    const probe = (await readFile(login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let provider = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    ).replace(/^#![^\n]*\n/u, "");
    provider = 'import { readFile } from "node:fs/promises";\n' + provider;
    provider = provider.replace(
      "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
      `
    const previous = await readFile(${JSON.stringify(log)}, "utf8").catch(() => "");
    await appendFile(${JSON.stringify(log)}, "invoked\\n");
    ${reportUsage ? 'send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});' : ""}
    if (previous.length === 0) {
      send({method:"turn/completed",params:{threadId,turn:{id:turnId,status:"failed",error:{message:"fixture_provider_failure"}}}}); return;
    }
    completeTurn(JSON.stringify({schemaVersion:1,operation:"allocate_existing",rationale:"Reuse available qualified staff after the bounded failed planning turn.",details:JSON.stringify({roleId:"developer",taskPurpose:"Inspect the current setup.",deliverables:["A verified report"],acceptanceCriteria:["Preserve existing behavior"],decisionLatitude:["Inspect within the task paths"],expectedPaths:["src"],requiredCapabilities:["filesystem.read"],verificationSuiteIds:["role.development.artifact"],completionSeconds:600})})); return;
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
    );
    await writeFile(
      login.executable,
      `${probe}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\n${provider}`,
    );
    const storage = await openProjectStorage(f.root);
    const open = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: { now: f.ports.now, recordAttention: f.ports.recordAttention },
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: {
          providerExecutables: { codex: login.executable },
          providerLoginContexts: { codex: login.context },
          verificationTools: {},
        },
      });
    let runtime = await open();
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      const decision = storage.events
        .list()
        .find((event) => event.type === "work.supervision.decision.recorded");
      const plan = (await readSupervisionJsonArtifact(
        storage.artifacts,
        String(decision?.payload.planArtifactHash),
      )) as OperatingActionPlanV1;
      expect(plan.reservedTokens).toBe(f.mandate.maximumAttemptTokens);
      await runtime.close();
      runtime = await open();
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      const retry = await runtime.runCycle();
      expect(retry.disposition, JSON.stringify(f.attention)).toBe(
        reportUsage ? "effect_confirmed" : "blocked",
      );
      const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
      const causes = source.events.filter((event) => event.type === "work.causality.recorded");
      expect(causes).toHaveLength(reportUsage ? 2 : 1);
      if (reportUsage) {
        expect(causes[1]!.payload).toMatchObject({
          relationship: "retry",
          parentRunId: causes[0]!.runId,
          retryOfRunId: causes[0]!.runId,
          attemptOrdinal: 2,
          assignmentId: null,
          workId: causes[0]!.payload.workId,
        });
        expect(source.workstreamResources.groups).toMatchObject([
          { completeness: "complete", totalTokens: 100 },
        ]);
        expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
        expect(await listAssignments(f.root)).toHaveLength(1);
      } else expect(await listAssignments(f.root)).toHaveLength(0);
      expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(reportUsage ? 2 : 1);
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  60_000,
);

it.each(["corrected", "exhausted", "malformed"] as const)(
  "bounds invalid completed owner proposals across restart (%s)",
  async (scenario) => {
    const login = await createLoginFixture(roots);
    const f = await supervisionFixture(
      roots,
      async (root) => {
        await writeFile(resolve(root, "AGENTS.md"), "Preserve exact responsibility paths.\n");
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        for (const args of [
          ["init"],
          ["config", "user.name", "Lervo Test"],
          ["config", "user.email", "test@example.invalid"],
          ["add", "AGENTS.md"],
          ["commit", "-m", "fixture"],
        ])
          await promisify(execFile)("git", ["-C", root, ...args]);
      },
      "developer",
      ["allocate_existing", "execute_as_owner", "escalate"],
    );
    const log = resolve(login.context.homeDirectory, "owner-correction.log");
    const probe = (await readFile(login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let provider = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    ).replace(/^#![^\n]*\n/u, "");
    provider = 'import { readFile } from "node:fs/promises";\n' + provider;
    provider = provider.replace(
      "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
      `
    const previous = await readFile(${JSON.stringify(log)}, "utf8").catch(() => "");
    await appendFile(${JSON.stringify(log)}, instructions+"\\n");
    send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});
    if (${scenario === "malformed"} && previous.length===0) { completeTurn("{not-json"); return; }
    completeTurn(JSON.stringify({schemaVersion:1,operation:"allocate_existing",rationale:"Use an exact scoped task.",details:JSON.stringify({roleId:"developer",taskPurpose:"Inspect the current setup.",deliverables:["A verified report"],acceptanceCriteria:["Preserve existing behavior"],decisionLatitude:["Inspect within the task paths"],expectedPaths:[${scenario === "exhausted" ? '"src/**"' : scenario === "malformed" ? '"src"' : 'previous.length===0?"src/**":"src"'}],requiredCapabilities:["filesystem.read"],verificationSuiteIds:["role.development.artifact"],completionSeconds:600})})); return;
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
    );
    await writeFile(
      login.executable,
      `${probe}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\n${provider}`,
    );
    const storage = await openProjectStorage(f.root);
    const open = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: { now: f.ports.now, recordAttention: f.ports.recordAttention },
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: {
          providerExecutables: { codex: login.executable },
          providerLoginContexts: { codex: login.context },
          verificationTools: {},
        },
      });
    let runtime = await open();
    try {
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(await listAssignments(f.root)).toHaveLength(0);
      await runtime.close();
      runtime = await open();
      const retried = await runtime.runCycle();
      expect(retried.disposition).toBe("effect_confirmed");
      expect(await listAssignments(f.root)).toHaveLength(0);
      const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
      const basis = await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now);
      const result = await readReusableOwnerDecision({
        storage,
        binding: f.binding,
        source,
        basisHash: basis.basisHash,
        report: retried.report!,
        now: f.ports.now,
      });
      expect(result.history).toHaveLength(2);
      expect(result.decision?.operation).toBe("allocate_existing");
      expect(await readFile(log, "utf8")).toContain(
        scenario === "malformed" ? "invalid_reasoning_result" : "invalid_expected_path",
      );
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      if (scenario === "exhausted") {
        expect(await listAssignments(f.root)).toHaveLength(0);
        expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
        expect(
          storage.events
            .list()
            .filter((event) => event.type === "work.supervision.escalation.recorded"),
        ).toMatchObject([{ payload: { reasonCode: "owner_proposal_invalid" } }]);
        expect((await runtime.runCycle()).disposition).toBe("idle");
      } else expect(await listAssignments(f.root)).toHaveLength(1);
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  60_000,
);

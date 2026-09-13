import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("inspects a silent tool-capable worker failure and waits across restart without retrying uncertain effects", async () => {
  const f = await dispatchFixture(
    roots,
    true,
    async (root) => {
      await writeFile(
        resolve(root, "AGENTS.md"),
        "Change only src/save.ts within the exact task.\n",
      );
      const policy = await loadRepositoryKnowledgePolicy(root);
      policy.normalization = { exclude: ["AGENTS.md"] };
      await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
      await applyKnowledgeMigrationPlan(
        await createKnowledgeMigrationPlan({ repositoryRoot: root }),
        new Date(),
        () => undefined,
      );
      return ["AGENTS.md", ".lervo/.gitignore"];
    },
    "developer",
    ["allocate_existing", "dispatch", "execute_as_owner", "escalate", "retry_attempt"],
  );
  const log = resolve(f.login.context.homeDirectory, "worker-failure.log");
  const login = (await readFile(f.login.executable, "utf8")).replace(
    "const args=",
    "function inspectLogin(){\nconst args=",
  );
  let provider = (
    await readFile(resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"), "utf8")
  ).replace(/^#![^\n]*\n/u, "");
  provider = provider.replace(
    "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
    `
    send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});
    if(instructions.includes("Act as the registered product owner.")) {
      const context=JSON.parse(instructions.slice(instructions.lastIndexOf("\\n\\n")+2));
      if(context.facts.failureFeedback.length!==1 || context.facts.failureFeedback[0].observation.status!=="uncertain") throw new Error("Missing actual uncertain worker evidence.");
      await appendFile(${JSON.stringify(log)},"owner-inspected\\n");
      completeTurn(JSON.stringify({schemaVersion:1,operation:"escalate",rationale:"The native worker stopped after a tool-capable failed turn. Its unknown effects need an explicit evidence-backed resolution before retry.",details:JSON.stringify({reasonCode:"worker_effects_require_review"})}));return;
    }
    await appendFile(${JSON.stringify(log)},"worker-failed\\n");
    send({method:"turn/completed",params:{threadId,turn:{id:turnId,status:"failed",error:{message:"fixture_silent_worker_failure"}}}});return;
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
  );
  await writeFile(
    f.login.executable,
    `${login}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\n${provider}`,
  );
  const storage = await openProjectStorage(f.root);
  const open = () =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: { now: f.ports.now, recordAttention: f.ports.recordAttention },
      ownerReasoning: { provider: "codex", reservedTokens: 100 },
      runtimeReadiness: f.runtimeReadiness,
      managedExecution: {
        nodeExecutable: process.execPath,
        cliBundle: resolve("apps/cli/dist/bin.js"),
      },
    });
  let runtime = await open();
  try {
    const cycles = [];
    for (let index = 0; index < 3; index++) {
      cycles.push(await runtime.runCycle());
      expect(cycles.at(-1)?.disposition, JSON.stringify({ cycles, attention: f.attention })).toBe(
        "effect_confirmed",
      );
      if (index === 0) {
        await runtime.close();
        runtime = await open();
      }
    }
    const before = await readFile(log, "utf8");
    expect(before).toBe("worker-failed\nowner-inspected\n");
    const count = storage.events.list({ limit: 1000 }).length;
    for (let index = 0; index < 2; index++)
      expect((await runtime.runCycle()).disposition).toBe("idle");
    await runtime.close();
    runtime = await open();
    expect((await runtime.runCycle()).disposition).toBe("idle");
    expect(storage.events.list({ limit: 1000 })).toHaveLength(count);
    expect(await readFile(log, "utf8")).toBe(before);
    expect(await listAssignments(f.root)).toMatchObject([{ status: "leased" }]);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "work.supervision.escalation.recorded"),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "work.causality.recorded" && event.payload.relationship === "retry",
      ),
    ).toHaveLength(0);
    expect(events.filter((event) => event.type === "assignment.completion.prepared")).toHaveLength(
      0,
    );
  } finally {
    await runtime.close();
    await storage.close();
  }
}, 60000);

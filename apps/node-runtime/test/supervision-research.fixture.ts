import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadRepositoryKnowledgePolicy,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

export async function researchAcceptanceFixture(roots: string[], maximumAttemptTokens?: number) {
  const cliBundle = resolve("apps/cli/dist/bin.js");
  const suite = {
    schemaVersion: 1 as const,
    suiteId: "role.research.artifact",
    stopOnFailure: true as const,
    commands: [
      {
        commandId: "research-artifact",
        executable: "node",
        arguments: [cliBundle, "research", "verify", "--json"],
        cwd: ".",
        timeoutMs: 10000,
        maxOutputBytes: 8192,
        environmentVariableNames: [
          "LERVO_RESEARCH_ARTIFACT_HASH",
          "LERVO_RESEARCH_CAS_ROOT",
          "LERVO_RESEARCH_INPUT_HASH",
        ],
      },
    ],
  };
  const f = await dispatchFixture(
    roots,
    true,
    async (root) => {
      await writeFile(
        resolve(root, "AGENTS.md"),
        "Read src/save.ts and answer the exact research question using the supplied source. Do not change source files.\n",
      );
      await mkdir(resolve(root, ".lervo/research"), { recursive: true });
      await writeFile(
        resolve(root, ".lervo/research/source-policy.json"),
        JSON.stringify({
          schemaVersion: 1,
          kind: "research.source_policy",
          policyId: "repository.sources",
          version: 1,
          projectId: `prj_${"a".repeat(16)}`,
          allowedPaths: ["src/save.ts"],
          maximumSources: 1,
          maximumSourceBytes: 4096,
          maximumAgeMs: 3600000,
          allowNetwork: false,
        }),
      );
      const policy = await loadRepositoryKnowledgePolicy(root);
      policy.normalization = { exclude: ["AGENTS.md"] };
      await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
      await applyKnowledgeMigrationPlan(
        await createKnowledgeMigrationPlan({ repositoryRoot: root }),
        new Date(),
        () => undefined,
      );
      return ["AGENTS.md", ".lervo/.gitignore", ".lervo/research/source-policy.json"];
    },
    "developer",
    ["allocate_existing", "dispatch", "execute_as_owner", "request_rework"],
    {
      suite,
      ...(maximumAttemptTokens === undefined ? {} : { maximumAttemptTokens }),
      requiredCapabilities: ["filesystem.read"],
      workerRoleId: "researcher",
      taskPurpose: "What value does src/save.ts export, and what does that source alone establish?",
    },
  );
  return { ...f, cliBundle };
}

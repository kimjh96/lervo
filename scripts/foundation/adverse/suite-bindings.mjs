import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const foundationAdverseSuiteBindings = [
  { area: "recovery", path: "packages/orchestrator/test/managed-provider-run-failures.test.ts" },
  { area: "recovery", path: "packages/event-store-sqlite/test/event-store.test.ts" },
  { area: "recovery", path: "packages/cas/test/cas.test.ts" },
  { area: "recovery", path: "packages/repository-knowledge/test/durable-apply.test.ts" },
  { area: "recovery", path: "packages/agent-workforce/test/workforce.test.ts" },
  { area: "recovery", path: "packages/orchestrator/test/workspace-integration.test.ts" },
  { area: "recovery", path: "apps/cli/test/terminal-integration.test.ts" },
  { area: "recovery", path: "packages/capabilities/test/capabilities.test.ts" },
  { area: "recovery", path: "packages/sync/test/worker.test.ts" },
  { area: "recovery", path: "packages/remote-command/test/remote-command.test.ts" },
  {
    area: "recovery",
    path: "packages/organization-deployment-contract/test/organization-fleet.test.ts",
  },
  { area: "concurrency", path: "packages/agent-workforce/test/assignment-graph.test.ts" },
  { area: "concurrency", path: "packages/agent-workforce/test/workspace-lifecycle.test.ts" },
  { area: "concurrency", path: "packages/orchestrator/test/workspace-assignment-claim.test.ts" },
  { area: "concurrency", path: "packages/event-store-sqlite/test/outbox.test.ts" },
  { area: "security", path: "packages/event-contract/test/redaction.test.ts" },
  { area: "security", path: "packages/capabilities/test/capabilities.test.ts" },
  {
    area: "security",
    path: "packages/organization-credential-source-file/test/owner-only-file-source.test.ts",
  },
  { area: "security", path: "packages/remote-command-sqlite/test/replay-store.test.ts" },
  { area: "compatibility", path: "packages/project/test/event-writer-activation.test.ts" },
  { area: "compatibility", path: "apps/cli/test/upgrade-command.test.ts" },
  { area: "compatibility", path: "packages/project/test/state-retention.test.ts" },
  {
    area: "compatibility",
    path: "packages/repository-knowledge/test/repository-knowledge.test.ts",
  },
  { area: "compatibility", path: "packages/search/test/evaluation-bundle.test.ts" },
];

export async function hashFoundationAdverseSuites(repositoryRoot) {
  return Promise.all(
    foundationAdverseSuiteBindings.map(async (binding) => ({
      ...binding,
      sourceHash: `sha256:${createHash("sha256")
        .update(await readFile(resolve(repositoryRoot, binding.path)))
        .digest("hex")}`,
    })),
  );
}

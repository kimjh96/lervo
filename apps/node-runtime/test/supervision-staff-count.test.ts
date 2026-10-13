import { rm } from "node:fs/promises";

import { listAgents, registerAgent } from "@lervo/agent-workforce";
import {
  convergenceAgentName,
  loadConvergenceDelegation,
} from "@lervo/repository-knowledge-runtime";
import { afterEach, expect, it } from "vitest";

import { fixture } from "../../../packages/repository-knowledge-runtime/test/fixture.js";
import { countSupervisionStaff } from "../src/supervision-staff-count.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("counts staff without the workers of the repository's convergence delegation", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const loaded = (await loadConvergenceDelegation(f.root))!;
  const hire = (displayName: string) =>
    registerAgent({
      repositoryRoot: f.root,
      roleId: "developer",
      provider: "codex",
      parentAgentId: loaded.delegation.parentAgentId,
      displayName,
    });
  const before = await countSupervisionStaff(f.root, await listAgents(f.root));
  await hire(convergenceAgentName("generator", loaded.contentHash));
  await hire(convergenceAgentName("reviewer", `sha256:${"c".repeat(64)}`));
  await hire("Niko");
  // Both delegation workers are bounded by the delegation; only the staff hire counts.
  expect(await countSupervisionStaff(f.root, await listAgents(f.root))).toBe(before + 1);
});

it("counts every active agent when no convergence delegation exists", async () => {
  const f = await fixture(false);
  fixtures.push(f);
  const agents = await listAgents(f.root);
  expect(await countSupervisionStaff(f.root, agents)).toBe(
    agents.filter((agent) => agent.status === "active").length,
  );
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { listRoleContracts, resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import { hiringGuidance } from "../src/room-hiring-guidance.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function role(roleId: string) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-room-hiring-"));
  roots.push(root);
  return resolveRoleContract(root, roleId);
}

describe("hiring guidance in a session's room block", () => {
  it("tells an agent that may hire to name hires like people and add a role when none fits", async () => {
    const guidance = hiringGuidance(await role("ceo"), "claude");
    expect(guidance).toContain(
      "lervo agent hire --role <role ID> --name <nickname> --provider claude --write --json",
    );
    expect(guidance).toContain("such as Bora or Haru, never by its specialty");
    expect(guidance).toContain("lervo role add --name");
    expect(guidance).toContain("lervo agent role --agent <agent ID>");
  });

  it("says nothing to an agent whose role may not hire", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-room-hiring-"));
    roots.push(root);
    const others = (await listRoleContracts(root)).filter(
      (contract) => !contract.definition.profile.requestTypes.includes("agent.hire"),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const contract of others) expect(hiringGuidance(contract, "claude")).toBeNull();
  });
});

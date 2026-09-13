import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { changeAgentStatus } from "@lervo/agent-workforce";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionPeerSource } from "../src/supervision-peer-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("observes a pinned peer without changing workforce state and rejects revoked owner authority", async () => {
  const f = await supervisionFixture(roots);
  const home = await resolveRepositoryCoordinationHome(f.root);
  const marker = resolve(home.root, "repository.json");
  const registry = resolve(home.workforce, "agents.json");
  const before = await Promise.all([marker, registry, home.root].map((path) => stat(path)));
  const configuration = {
    repositoryRoot: f.root,
    repositoryInstanceId: home.repositoryInstanceId,
    projectId: f.owner.projectId,
    teamId: f.mandate.teamIds[0]!,
    binding: f.binding,
  };
  const peer = await SupervisionPeerSource.open(configuration, f.ports.now);
  try {
    expect(await peer.read()).toMatchObject({
      party: { projectId: f.owner.projectId, ownerAgentId: f.owner.agentId },
      repositoryInstanceId: home.repositoryInstanceId,
    });
    expect(
      (await Promise.all([marker, registry, home.root].map((path) => stat(path)))).map(
        (info) => info.mtimeMs,
      ),
    ).toEqual(before.map((info) => info.mtimeMs));
    await expect(peer.storage.artifacts.put("not owned by observer")).rejects.toMatchObject({
      code: "read_only",
    });
    await changeAgentStatus({
      repositoryRoot: f.root,
      agentId: f.owner.agentId,
      expectedRevision: f.owner.revision,
      status: "suspended",
    });
    await expect(peer.read()).rejects.toThrow(/owner|authority/iu);
  } finally {
    await peer.close();
  }
  await expect(
    SupervisionPeerSource.open(
      { ...configuration, repositoryInstanceId: "rpi_" + "0".repeat(24) },
      f.ports.now,
    ),
  ).rejects.toThrow(/exact repository instance/iu);
});

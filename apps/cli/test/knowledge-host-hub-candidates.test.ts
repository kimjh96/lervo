import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { registerRepository } from "@lervo/repository-registry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { knowledgeHostHubCandidates } from "../src/knowledge-host-hub-candidates.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const hub = {
  baseUrl: "https://hub.example/",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};

async function host() {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-hub-candidates-")));
  directories.push(directory);
  const state = resolve(directory, "state");
  await mkdir(state, { recursive: true, mode: 0o700 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  const checkout = async (name: string, projectId: string) => {
    const root = resolve(directory, name);
    await mkdir(root);
    await applyInitPlan(await createInitPlan({ root, projectId }));
    await registerRepository({
      registryPath: resolve(state, "repositories.json"),
      repositoryRoot: root,
    });
    return root;
  };
  return { directory, state, checkout };
}

describe("host Hub candidates (ADR-0470)", () => {
  it("offers this project's own credential, never another repository's token (ADR-0656)", async () => {
    const { state, checkout } = await host();
    const lervo = await checkout("lervo", "prj_candidates_lervo");
    const plen = await checkout("plen", "prj_candidates_plen");
    await mkdir(resolve(lervo, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(
      resolve(lervo, ".lervo/state/knowledge/convergence-owner-host.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostId: `hst_${"1".repeat(32)}`,
        hostLabel: "mac",
        coordination: { mode: "hub", hub: { ...hub, bearerTokenFile: "/secrets/lervo.token" } },
      }),
    );
    const own = resolve(state, "nodes", "prj_candidates_plen", "secrets");
    await mkdir(own, { recursive: true });
    await writeFile(resolve(own, "hub-sync.token"), "token", { mode: 0o600 });

    expect(await knowledgeHostHubCandidates(plen)).toEqual([
      {
        source: "host_repository",
        hub: { ...hub, bearerTokenFile: resolve(own, "hub-sync.token") },
      },
    ]);
  });

  it("offers a project without a token of its own only its own token path, never another's", async () => {
    const { state, checkout } = await host();
    const lervo = await checkout("lervo", "prj_candidates_lervo");
    const plen = await checkout("plen", "prj_candidates_plen");
    await mkdir(resolve(lervo, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(
      resolve(lervo, ".lervo/state/knowledge/convergence-owner-host.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostId: `hst_${"1".repeat(32)}`,
        hostLabel: "mac",
        coordination: { mode: "hub", hub: { ...hub, bearerTokenFile: "/secrets/lervo.token" } },
      }),
    );
    expect(await knowledgeHostHubCandidates(plen)).toEqual([
      {
        source: "host_repository",
        hub: {
          ...hub,
          bearerTokenFile: resolve(
            state,
            "nodes",
            "prj_candidates_plen",
            "secrets",
            "hub-sync.token",
          ),
        },
        credential: "absent",
      },
    ]);
  });

  it("uses a per-project Node configuration's Hub block as written", async () => {
    const { state, checkout } = await host();
    const plen = await checkout("plen", "prj_candidates_plen");
    const directory = resolve(state, "nodes", "prj_candidates_plen");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "config.json"),
      JSON.stringify({ hub: { ...hub, bearerTokenFile: "secrets/hub-sync.token" } }),
    );
    expect(await knowledgeHostHubCandidates(plen)).toEqual([
      {
        source: "host_repository",
        hub: { ...hub, bearerTokenFile: resolve(directory, "secrets/hub-sync.token") },
      },
    ]);
  });
});

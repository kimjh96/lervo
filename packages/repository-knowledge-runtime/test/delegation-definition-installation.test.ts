import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import {
  calculateProjectIdentityHash,
  createKnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinition,
} from "@lervo/sync-contract";
import { verificationSuiteHash } from "@lervo/verification";
import { afterEach, describe, expect, it } from "vitest";

import { reproducedBoundDefinitions } from "../src/delegation-definition-catalog.js";
import type { ConvergenceDefinitionSource } from "../src/delegation-definition-acceptance.js";
import { installBoundDefinitions } from "../src/delegation-definition-installation.js";
import type { ConvergenceDelegation } from "../src/delegation.js";
import { peerHost } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const SCOPE_HASH = `sha256:${"5".repeat(64)}`;
const SUITE_PATH = ".lervo/verifications/knowledge.fixture.yaml";
const ROLE_PATH = ".lervo/roles/knowledge-steward.json";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function hosts() {
  const owner = await fixture(true);
  cleanups.push(async () => {
    await owner.storage.close();
    await rm(owner.directory, { recursive: true, force: true });
  });
  const peer = await peerHost({ sourceRoot: owner.root, directory: owner.directory });
  cleanups.push(() => peer.storage.close());
  return { owner, peer };
}

/** What a host that reproduces `scope` would have shared through the Hub. */
async function sharedBy(
  root: string,
  scope: ConvergenceDelegation,
  manifest: Parameters<typeof calculateProjectIdentityHash>[0],
): Promise<ConvergenceDefinitionSource> {
  const shared: KnowledgeConvergenceDefinition[] = [];
  for (const item of await reproducedBoundDefinitions(root, scope)) {
    const definition = createKnowledgeConvergenceDefinition({
      projectId: scope.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(manifest),
      kind: item.kind,
      bindingHash: item.bindingHash,
      content: item.content,
      publishedAt: new Date().toISOString(),
      sourceHostHash: `sha256:${"6".repeat(64)}`,
    });
    if (definition !== null) shared.push(definition);
  }
  return {
    candidates: async (kind, bindingHash) =>
      shared.filter((item) => item.kind === kind && item.bindingHash === bindingHash),
  };
}

const install = (
  peer: Awaited<ReturnType<typeof peerHost>>,
  scope: ConvergenceDelegation,
  source: ConvergenceDefinitionSource,
) =>
  installBoundDefinitions({
    storage: peer.storage as Awaited<ReturnType<typeof fixture>>["storage"],
    scope,
    scopeHash: SCOPE_HASH,
    source,
    observerHostHash: null,
    sourceHostHash: null,
    now: new Date(),
  });

describe("installing delegation-bound definitions (ADR-0477)", () => {
  it("installs a repository role whose contract reproduces the binding", async () => {
    const { owner, peer } = await hosts();
    await mkdir(resolve(owner.root, ".lervo/roles"), { recursive: true });
    await writeFile(
      resolve(owner.root, ROLE_PATH),
      JSON.stringify({
        schemaVersion: 1,
        kind: "lervo_repository_role",
        roleId: "knowledge-steward",
        version: "1.0.0",
        extends: [{ roleId: "developer", version: "1.0.0" }],
        profile: {
          name: "Knowledge Steward",
          description: "Keeps repository knowledge current for the owner on every host.",
          requestTypes: ["knowledge.stewardship"],
        },
        checks: [],
      }),
    );
    const contract = await resolveRoleContract(owner.root, "knowledge-steward");
    const binding = {
      roleId: "knowledge-steward",
      version: contract.version,
      contractHash: contract.contractHash,
      profileHash: roleProfileHash(contract.definition.profile),
      capabilityHash: owner.delegation!.roles.generator.capabilityHash,
    };
    const scope: ConvergenceDelegation = {
      ...owner.delegation!,
      roles: { ...owner.delegation!.roles, generator: binding },
    };
    const installed = await install(
      peer,
      scope,
      await sharedBy(owner.root, scope, owner.storage.manifest),
    );
    expect(installed.map((item) => item.kind).sort()).toEqual([
      "repository_role",
      "verification_suite",
    ]);
    expect((await resolveRoleContract(peer.root, "knowledge-steward")).contractHash).toBe(
      contract.contractHash,
    );
  });

  it("replaces only a file Lervo installed and nobody changed", async () => {
    const { owner, peer } = await hosts();
    const first = owner.delegation!;
    expect(
      await install(peer, first, await sharedBy(owner.root, first, owner.storage.manifest)),
    ).toEqual([expect.objectContaining({ action: "created" })]);

    // The owner reviews a changed suite; the managed copy on the peer follows it.
    const suite = JSON.parse(await readFile(resolve(owner.root, SUITE_PATH), "utf8")) as {
      commands: { timeoutMs: number }[];
    };
    suite.commands[0]!.timeoutMs = 20_000;
    await writeFile(resolve(owner.root, SUITE_PATH), JSON.stringify(suite));
    const second: ConvergenceDelegation = {
      ...first,
      verification: [
        {
          suiteId: "knowledge.fixture",
          suiteHash: verificationSuiteHash(suite as never),
        },
      ],
    };
    const source = await sharedBy(owner.root, second, owner.storage.manifest);
    expect(await install(peer, second, source)).toEqual([
      expect.objectContaining({ action: "replaced" }),
    ]);

    // Once someone edits the managed file it is theirs, and Lervo stops.
    await writeFile(resolve(peer.root, SUITE_PATH), "# edited\n{}\n");
    await expect(
      install(peer, first, await sharedBy(owner.root, second, owner.storage.manifest)),
    ).rejects.toMatchObject({ code: "convergence_seed_definition_unavailable" });
    await expect(install(peer, second, source)).rejects.toMatchObject({
      code: "convergence_seed_definition_conflict",
    });
    expect(await readFile(resolve(peer.root, SUITE_PATH), "utf8")).toBe("# edited\n{}\n");
  });
});

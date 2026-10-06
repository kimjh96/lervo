import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  isKnowledgeConvergenceDefinition,
  knowledgeConvergenceDefinitionSummary,
  mergeKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceDefinition,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";
import { loadVerificationSuite, verificationSuiteHash } from "@lervo/verification";
import { afterEach, describe, expect, it } from "vitest";

import {
  sealConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicy,
} from "../src/continuity-policy.js";
import {
  ConvergenceContinuity,
  type ConvergenceHostRecordPort,
} from "../src/convergence-continuity.js";
import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { readConvergenceOwnerHost } from "../src/convergence-owner-host.js";
import { CONVERGENCE_DELEGATION_PATH, loadConvergenceDelegation } from "../src/delegation.js";
import { CONVERGENCE_INSTALLED_DEFINITIONS_PATH } from "../src/delegation-definition-ledger.js";
import { convergenceDelegationScopeHash } from "../src/delegation-scope.js";
import { FakeConvergenceOwnerHub, peerHost } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const DAY = 24 * 60 * 60_000;
const SUITE_PATH = ".lervo/verifications/knowledge.fixture.yaml";
const hub = {
  baseUrl: "https://hub.example/",
  bearerTokenFile: "/owner-only/hub-token",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};
const publication = {
  remote: "origin",
  baseBranch: "main",
  branch: "lervo/knowledge-outputs",
  merge: "when_checks_pass" as const,
  allowedRoots: ["docs/", ".lervo/knowledge/"],
};

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Host = Pick<Fixture, "storage" | "root">;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The production record merge and definition contract, in memory, shared by both hosts. */
class FakeHub {
  records = new Map<string, KnowledgeConvergenceHostRecord>();
  definitions = new Map<string, { definition: KnowledgeConvergenceDefinition; at: string }>();
  /** `older` answers the definitions route like a Hub without ADR-0477. */
  mode: "current" | "older" = "current";
  /** Served in place of the stored definition, as a forged or corrupted Hub would. */
  forged: KnowledgeConvergenceDefinition | null = null;

  private older(): never {
    throw Object.assign(new Error("not found"), {
      failureCode: "hub_response_invalid",
      httpStatus: 404,
    });
  }

  port(): ConvergenceHostRecordPort {
    return {
      publish: async (record) => {
        const { next, status } = mergeKnowledgeConvergenceHostRecord({
          current: this.records.get(record.hostHash) ?? null,
          incoming: structuredClone(record),
        });
        this.records.set(record.hostHash, next);
        return status;
      },
      list: async () => [...this.records.values()].map((record) => structuredClone(record)),
      definitions: {
        publish: async (definition) => {
          if (this.mode === "older") this.older();
          if (!isKnowledgeConvergenceDefinition(definition)) throw new Error("invalid");
          const existing = this.definitions.get(definition.contentHash);
          this.definitions.set(definition.contentHash, {
            definition: existing?.definition ?? structuredClone(definition),
            at: definition.publishedAt,
          });
          return existing === undefined ? "created" : "refreshed";
        },
        list: async () => {
          if (this.mode === "older") this.older();
          if (this.forged !== null) return [knowledgeConvergenceDefinitionSummary(this.forged)];
          return [...this.definitions.values()].map(({ definition, at }) => ({
            ...knowledgeConvergenceDefinitionSummary(definition),
            publishedAt: at,
          }));
        },
        read: async (contentHash) => {
          if (this.mode === "older") this.older();
          if (this.forged !== null) return structuredClone(this.forged);
          const stored = this.definitions.get(contentHash);
          return stored === undefined ? null : structuredClone(stored.definition);
        },
      },
    };
  }
}

function policy(): ConvergenceContinuityPolicy {
  const now = Date.now();
  const ceilings = {
    maximumStages: 8,
    maximumDocuments: 8,
    maximumSourceBytes: 1_048_576,
    maximumProviderCalls: 8,
  };
  return sealConvergenceContinuityPolicy({
    schemaVersion: 1,
    state: "active",
    authority: { kind: "owner_installed", reference: null },
    issuedAt: new Date(now - DAY).toISOString(),
    horizonAt: new Date(now + 300 * DAY).toISOString(),
    renewal: { termDays: 30, windowHours: 48, attentionLeadHours: 72 },
    seeding: { fromPeer: true, fromTemplate: false },
    limits: { providers: ["claude"], resourceCeilings: ceilings },
    template: null,
  });
}

function continuity(host: Host, policyPath: string, hosts: FakeHub, label: string) {
  return new ConvergenceContinuity({
    storage: host.storage as Fixture["storage"],
    policyPath,
    hubCandidates: async () => [{ source: "node_runtime" as const, hub }],
    transport: async () => hosts.port(),
    publication: async () => publication,
    hostLabel: label,
  });
}

/**
 * The Mac checkout holds the reviewed delegation and its suite, which (as on the WSL checkout in
 * the field) is untracked. The peer is a clone of the same repository that never saw the suite.
 */
async function twoHosts() {
  const mac = await fixture(true);
  cleanups.push(async () => {
    await mac.storage.close();
    await rm(mac.directory, { recursive: true, force: true });
  });
  const policyPath = resolve(mac.directory, "user-state", "knowledge-continuity-policy.json");
  await mkdir(resolve(mac.directory, "user-state"), { recursive: true });
  await writeFile(policyPath, JSON.stringify(policy()), { mode: 0o600 });
  const hosts = new FakeHub();
  await continuity(mac, policyPath, hosts, "mac").reconcile();
  const peer = await peerHost({ sourceRoot: mac.root, directory: mac.directory });
  cleanups.push(() => peer.storage.close());
  await rm(resolve(peer.root, CONVERGENCE_DELEGATION_PATH));
  await expect(access(resolve(peer.root, ".lervo/verifications"))).rejects.toThrow();
  return { mac, peer, hosts, policyPath };
}

function events(host: Host, type: string) {
  return host.storage.events.list({ limit: 500 }).filter((event) => event.type === type);
}

describe("delegation-bound definitions across hosts (ADR-0477)", () => {
  it("installs the peer's untracked suite, seeds, and waits for the owner", async () => {
    const { mac, peer, hosts, policyPath } = await twoHosts();
    const macDelegation = (await loadConvergenceDelegation(mac.root))!.delegation;
    expect([...hosts.definitions.values()].map(({ definition }) => definition.bindingHash)).toEqual(
      macDelegation.verification.map((suite) => suite.suiteHash),
    );

    const state = await continuity(peer, policyPath, hosts, "wsl").reconcile();
    expect(state?.continuationFailure).toBeNull();
    expect(state).toMatchObject({
      delegation: { state: "active" },
      lastContinuation: { action: "seeded", source: "peer" },
    });
    const peerDelegation = (await loadConvergenceDelegation(peer.root))!.delegation;
    expect(convergenceDelegationScopeHash(peerDelegation)).toBe(
      convergenceDelegationScopeHash(macDelegation),
    );
    expect(verificationSuiteHash(await loadVerificationSuite(peer.root, "knowledge.fixture"))).toBe(
      macDelegation.verification[0]!.suiteHash,
    );
    expect(await readFile(resolve(peer.root, SUITE_PATH), "utf8")).toMatch(
      /^# Lervo-managed verification suite \(ADR-0477\)/u,
    );
    const ledger = JSON.parse(
      await readFile(resolve(peer.root, CONVERGENCE_INSTALLED_DEFINITIONS_PATH), "utf8"),
    ) as { entries: { path: string }[] };
    expect(ledger.entries.map((entry) => entry.path)).toEqual([SUITE_PATH]);
    const macHost = await readConvergenceOwnerHost(mac.root);
    expect(events(peer, "knowledge.convergence.definitions.installed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          sourceHostHash: macHost!.hostHash,
          definitions: [
            expect.objectContaining({
              kind: "verification_suite",
              bindingHash: macDelegation.verification[0]!.suiteHash,
              action: "created",
            }),
          ],
        }),
      }),
    ]);

    const clock = { now: Date.now() };
    const lease = new FakeConvergenceOwnerHub(() => clock.now);
    const ownership = (storage: Fixture["storage"]) =>
      new ConvergenceOwnership({
        storage,
        provider: "claude",
        transport: async () => lease.port(),
        now: () => clock.now,
      });
    expect((await ownership(mac.storage).observe()).role).toBe("owner");
    const waiting = await ownership(peer.storage as Fixture["storage"]).observe();
    expect(waiting.role).toBe("waiting_owner");
    expect(waiting.holder?.label).toBe("mac");
  });

  it("never overwrites a different user-owned suite and names the conflict", async () => {
    const { peer, hosts, policyPath } = await twoHosts();
    const own = "# my own suite\n{}\n";
    await mkdir(resolve(peer.root, ".lervo/verifications"), { recursive: true });
    await writeFile(resolve(peer.root, SUITE_PATH), own);
    const state = await continuity(peer, policyPath, hosts, "wsl").reconcile();
    expect(state?.delegation.state).toBe("missing");
    expect(state?.findings).toContainEqual({
      code: "delegation_missing",
      severity: "attention",
      detail: "convergence_seed_definition_conflict",
    });
    expect(await readFile(resolve(peer.root, SUITE_PATH), "utf8")).toBe(own);
    expect(events(peer, "knowledge.convergence.definitions.installed")).toEqual([]);
  });

  it("refuses shared content that does not reproduce the reviewed binding", async () => {
    const { peer, hosts, policyPath } = await twoHosts();
    const [stored] = [...hosts.definitions.values()];
    const content = {
      ...(stored!.definition.content as Record<string, unknown>),
      stopOnFailure: false,
    };
    hosts.forged = { ...stored!.definition, content };
    const state = await continuity(peer, policyPath, hosts, "wsl").reconcile();
    expect(state?.delegation.state).toBe("missing");
    expect(state?.findings).toContainEqual(
      expect.objectContaining({
        code: "delegation_missing",
        detail: "convergence_seed_definition_unavailable",
      }),
    );
    await expect(access(resolve(peer.root, SUITE_PATH))).rejects.toThrow();
  });

  it("names a Hub without the definitions route and keeps exchanging host records", async () => {
    const { peer, hosts, policyPath } = await twoHosts();
    hosts.mode = "older";
    const state = await continuity(peer, policyPath, hosts, "wsl").reconcile();
    expect(state?.hub).toEqual({ status: "ok", failureCode: null });
    expect(state?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "delegation_missing",
          detail: "convergence_seed_definition_unavailable",
        }),
        {
          code: "definition_exchange_unavailable",
          severity: "attention",
          detail: "hub_definitions_unsupported",
        },
      ]),
    );
    expect(hosts.records.size).toBe(2);
  });
});

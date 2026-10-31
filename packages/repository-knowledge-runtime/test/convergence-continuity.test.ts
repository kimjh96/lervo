import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { resolve } from "node:path";

import { listAgents } from "@lervo/agent-workforce";
import {
  mergeKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { readConvergenceContinuityPolicy } from "../src/continuity-policy-store.js";
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
import { convergenceDelegationScopeHash } from "../src/delegation-scope.js";
import { FakeConvergenceOwnerHub, peerHost } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const DAY = 24 * 60 * 60_000;
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
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tracked(authorized: boolean): Promise<Fixture> {
  const f = await fixture(authorized);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return f;
}

/** An in-memory Hub host-record table with the production merge, shared by both hosts. */
class FakeHostRecordHub {
  records = new Map<string, KnowledgeConvergenceHostRecord>();
  refuse: { failureCode: string; httpStatus: number } | null = null;

  port(): ConvergenceHostRecordPort {
    return {
      publish: async (record) => {
        if (this.refuse !== null) throw Object.assign(new Error("refused"), this.refuse);
        const { next, status } = mergeKnowledgeConvergenceHostRecord({
          current: this.records.get(record.hostHash) ?? null,
          incoming: structuredClone(record),
        });
        this.records.set(record.hostHash, next);
        return status;
      },
      list: async () => {
        if (this.refuse !== null) throw Object.assign(new Error("refused"), this.refuse);
        return [...this.records.values()].map((record) => structuredClone(record));
      },
    };
  }
}

function continuity(input: {
  f: Pick<Fixture, "storage">;
  policyPath: string;
  hosts?: FakeHostRecordHub;
  label?: string;
  now?: () => number;
}): ConvergenceContinuity {
  return new ConvergenceContinuity({
    providerAdmission: async () => null,
    storage: input.f.storage as Fixture["storage"],
    policyPath: input.policyPath,
    hubCandidates: async () =>
      input.hosts === undefined ? [] : [{ source: "node_runtime" as const, hub }],
    ...(input.hosts === undefined ? {} : { transport: async () => input.hosts!.port() }),
    publication: async () => publication,
    hostLabel: input.label ?? "mac",
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

async function policyFile(f: Fixture, policy?: ConvergenceContinuityPolicy): Promise<string> {
  const path = resolve(f.directory, "user-state", "knowledge-continuity-policy.json");
  if (policy !== undefined) {
    await mkdir(resolve(f.directory, "user-state"), { recursive: true });
    await writeFile(path, JSON.stringify(policy), { mode: 0o600 });
  }
  return path;
}

function templatePolicy(state: "active" | "revoked" = "active"): ConvergenceContinuityPolicy {
  const now = Date.now();
  const ceilings = {
    maximumStages: 8,
    maximumDocuments: 8,
    maximumSourceBytes: 1_048_576,
    maximumProviderCalls: 8,
  };
  return sealConvergenceContinuityPolicy({
    schemaVersion: 1,
    state,
    authority: { kind: "owner_installed", reference: null },
    issuedAt: new Date(now - DAY).toISOString(),
    horizonAt: new Date(now + 300 * DAY).toISOString(),
    renewal: { termDays: 30, windowHours: 48, attentionLeadHours: 72 },
    seeding: { fromPeer: true, fromTemplate: true },
    limits: { providers: ["claude"], resourceCeilings: ceilings },
    template: {
      parentRoleId: "developer",
      roleIds: {
        generator: "developer",
        reviewer: "developer",
        writer: "developer",
        integrator: "developer",
      },
      canonicalRoots: ["docs/specs", "AGENTS.md", "missing-root"],
      normalizationRoots: ["docs/specs", "AGENTS.md"],
      providers: ["claude"],
      integrationRef: "refs/heads/knowledge-integration",
      resourceCeilings: ceilings,
      verificationSuite: "repository_default",
    },
  });
}

/** ADR-0478: only the convergence owner renews, so these single-host cases own first. */
async function standaloneOwner(f: Fixture): Promise<void> {
  expect(
    await new ConvergenceOwnership({ storage: f.storage, provider: "claude" }).observe(),
  ).toMatchObject({
    role: "owner",
  });
}

function continuedEvents(f: Pick<Fixture, "storage">) {
  return f.storage.events
    .list({ limit: 500 })
    .filter((event) => event.type === "knowledge.convergence.delegation.continued");
}

describe("delegation continuity", () => {
  it("adopts the owner's standing policy from a reviewed delegation and renews it at the same scope", async () => {
    const f = await tracked(true);
    const path = await policyFile(f);
    await standaloneOwner(f);
    const before = (await loadConvergenceDelegation(f.root))!.delegation;
    const state = await continuity({ f, policyPath: path }).reconcile();
    const policy = await readConvergenceContinuityPolicy(path);
    expect(policy).toMatchObject({
      status: "loaded",
      policy: { state: "active", authority: { kind: "owner_instruction", reference: "ADR-0469" } },
    });
    const after = (await loadConvergenceDelegation(f.root))!.delegation;
    // The fixture expires in one day, inside the 48-hour window, so it renews immediately.
    expect(Date.parse(after.expiresAt)).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(convergenceDelegationScopeHash(after)).toBe(convergenceDelegationScopeHash(before));
    expect(after.parentAgentId).toBe(before.parentAgentId);
    expect(state).toMatchObject({
      delegation: { state: "active" },
      lastContinuation: { action: "renewed", source: "renewal" },
      continuationFailure: null,
    });
    expect(continuedEvents(f)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          action: "renewed",
          source: "renewal",
          previousPlanHash: before.review.planHash,
          planHash: after.review.planHash,
          scopeHash: convergenceDelegationScopeHash(before),
        }),
      }),
    ]);
    // A reconciliation inside the hourly interval does nothing, a forced one renews nothing new.
    await continuity({ f, policyPath: path }).reconcile({ force: true });
    expect(continuedEvents(f)).toHaveLength(1);
  });

  it("rebinds a delegation whose suite a managed upgrade rewrote, keeping every scope identifier (ADR-0470)", async () => {
    const f = await tracked(true);
    const path = await policyFile(f);
    await standaloneOwner(f);
    await continuity({ f, policyPath: path }).reconcile();
    const renewed = (await loadConvergenceDelegation(f.root))!.delegation;
    const suite = renewed.verification[0]!;
    const suitePath = resolve(f.root, ".lervo/verifications", `${suite.suiteId}.yaml`);
    const definition = JSON.parse(await readFile(suitePath, "utf8"));
    definition.commands[0].timeoutMs += 1;
    await writeFile(suitePath, JSON.stringify(definition));

    const state = await continuity({ f, policyPath: path }).reconcile({ force: true });
    const rebound = (await loadConvergenceDelegation(f.root))!.delegation;
    expect(rebound.verification).toEqual([
      { suiteId: suite.suiteId, suiteHash: expect.not.stringMatching(suite.suiteHash) },
    ]);
    expect(rebound.expiresAt).toBe(renewed.expiresAt);
    expect(rebound.canonicalRoots).toEqual(renewed.canonicalRoots);
    expect(rebound.roles).toEqual(renewed.roles);
    expect(state).toMatchObject({
      lastContinuation: { action: "rebound", source: "binding_refresh" },
      continuationFailure: null,
    });
    expect(continuedEvents(f).at(-1)).toMatchObject({
      payload: {
        action: "rebound",
        source: "binding_refresh",
        previousPlanHash: renewed.review.planHash,
        planHash: rebound.review.planHash,
      },
    });
    // Nothing drifted any more, so a further reconciliation records nothing new.
    const count = continuedEvents(f).length;
    await continuity({ f, policyPath: path }).reconcile({ force: true });
    expect(continuedEvents(f)).toHaveLength(count);
  });

  it("never renews under a revoked policy and asks the owner before the delegation lapses", async () => {
    const f = await tracked(true);
    const path = await policyFile(f, templatePolicy("revoked"));
    const before = await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH), "utf8");
    const state = await continuity({ f, policyPath: path }).reconcile();
    expect(await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH), "utf8")).toBe(before);
    expect(state?.findings).toEqual(
      expect.arrayContaining([
        { code: "delegation_expiring", severity: "owner_decision", detail: "policy_revoked" },
        { code: "policy_revoked", severity: "info", detail: null },
      ]),
    );
    expect(continuedEvents(f)).toEqual([]);
  });

  it("refuses to renew a delegation outside the policy limits", async () => {
    const f = await tracked(true);
    const policy = templatePolicy();
    const { policyId: _id, policyHash: _hash, ...body } = policy;
    const path = await policyFile(
      f,
      sealConvergenceContinuityPolicy({
        ...body,
        limits: { ...body.limits, providers: ["codex"] },
      }),
    );
    const state = await continuity({ f, policyPath: path }).reconcile();
    expect(state?.findings).toContainEqual({
      code: "delegation_outside_policy",
      severity: "owner_decision",
      detail: "provider_outside_policy",
    });
    expect(continuedEvents(f)).toEqual([]);
  });
});

describe("two hosts of one repository", () => {
  it("seeds the peer's missing delegation through the Hub and elects one owner", async () => {
    const mac = await tracked(true);
    const path = await policyFile(mac, templatePolicy());
    const hosts = new FakeHostRecordHub();
    const macState = await continuity({
      f: mac,
      policyPath: path,
      hosts,
      label: "mac",
    }).reconcile();
    expect(macState).toMatchObject({ ownerHost: { state: "hub", publication: "configured" } });
    expect(hosts.records.size).toBe(1);

    const wsl = await peerHost({ sourceRoot: mac.root, directory: mac.directory });
    cleanups.push(() => wsl.storage.close());
    await rm(resolve(wsl.root, CONVERGENCE_DELEGATION_PATH));
    // The fixture writes its suite after the initial commit; real suites are tracked sources.
    await cp(resolve(mac.root, ".lervo/verifications"), resolve(wsl.root, ".lervo/verifications"), {
      recursive: true,
    });
    const wslState = await continuity({
      f: wsl,
      policyPath: path,
      hosts,
      label: "wsl",
    }).reconcile();
    expect(wslState?.continuationFailure).toBeNull();
    expect(wslState).toMatchObject({
      delegation: { state: "active" },
      lastContinuation: { action: "seeded", source: "peer" },
    });
    const macDelegation = (await loadConvergenceDelegation(mac.root))!.delegation;
    const wslDelegation = (await loadConvergenceDelegation(wsl.root))!.delegation;
    expect(convergenceDelegationScopeHash(wslDelegation)).toBe(
      convergenceDelegationScopeHash(macDelegation),
    );
    // The peer's accountable agent is its own; agent identities never cross hosts.
    expect((await listAgents(wsl.root)).map((agent) => agent.agentId)).toContain(
      wslDelegation.parentAgentId,
    );
    const macHost = await readConvergenceOwnerHost(mac.root);
    expect(continuedEvents(wsl)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          action: "seeded",
          source: "peer",
          sourceHostHash: macHost!.hostHash,
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
    const verdicts = [
      await ownership(mac.storage).observe(),
      await ownership(wsl.storage as Fixture["storage"]).observe(),
    ];
    expect(verdicts.map((verdict) => verdict.role).sort()).toEqual(["owner", "waiting_owner"]);
    expect(verdicts.find((verdict) => verdict.role === "waiting_owner")?.holder?.label).toBe("mac");
  });

  it("keeps a refused host read-only in Hub mode and reports the cause (ADR-0470)", async () => {
    const f = await tracked(true);
    const path = await policyFile(f, templatePolicy());
    const hosts = new FakeHostRecordHub();
    hosts.refuse = { failureCode: "hub_forbidden", httpStatus: 403 };
    const state = await continuity({ f, policyPath: path, hosts }).reconcile();
    expect(state).toMatchObject({
      ownerHost: { state: "hub", hubFailureCode: "hub_forbidden" },
    });
    expect(state?.findings).toContainEqual({
      code: "owner_host_hub_unusable",
      severity: "attention",
      detail: "hub_forbidden",
    });
  });
});

describe("default onboarding of a new repository", () => {
  it("reaches an active delegation, Hub coordination, publication, and a lease on its first cycle", async () => {
    const f = await tracked(false);
    // `lervo init` registers the developer agent; the repository has its own default suite.
    const { registerAgent } = await import("@lervo/agent-workforce");
    await registerAgent({ repositoryRoot: f.root, roleId: "developer", provider: "any" });
    await mkdir(resolve(f.root, ".lervo/verifications"), { recursive: true });
    await writeFile(
      resolve(f.root, ".lervo/verifications/repository.default.v1.yaml"),
      JSON.stringify({
        schemaVersion: 1,
        suiteId: "repository.default.v1",
        stopOnFailure: true,
        commands: [
          {
            commandId: "check",
            executable: "node",
            arguments: ["-e", "process.exit(0)"],
            cwd: ".",
            timeoutMs: 10000,
            maxOutputBytes: 16384,
            environmentVariableNames: [],
          },
        ],
      }),
    );
    const path = await policyFile(f, templatePolicy());
    const hosts = new FakeHostRecordHub();
    const state = await continuity({ f, policyPath: path, hosts, label: "wsl" }).reconcile();
    expect(state).toMatchObject({
      delegation: { state: "active" },
      lastContinuation: { action: "seeded", source: "policy_template" },
      ownerHost: { state: "hub", publication: "configured" },
      hub: { status: "ok" },
    });
    const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
    expect(delegation.canonicalRoots).toEqual(["docs/specs", "AGENTS.md"]);
    expect(delegation.verification.map((suite) => suite.suiteId)).toEqual([
      "repository.default.v1",
    ]);
    expect((await readConvergenceOwnerHost(f.root))?.config.publication).toEqual(publication);

    const lease = new FakeConvergenceOwnerHub(Date.now);
    const verdict = await new ConvergenceOwnership({
      storage: f.storage,
      provider: "claude",
      transport: async () => lease.port(),
    }).observe();
    expect(verdict).toMatchObject({ role: "owner", mode: "hub" });
    expect(state?.findings.filter((finding) => finding.severity !== "info")).toEqual([]);
  });
});

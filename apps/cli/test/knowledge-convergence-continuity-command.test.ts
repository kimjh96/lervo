import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { registerRepository } from "@lervo/repository-registry";
import {
  ConvergenceOwnership,
  type ContinuityFinding,
  type ContinuityFindingCode,
} from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixture } from "../../../packages/repository-knowledge-runtime/test/fixture.js";
import { knowledgeBackgroundOwner } from "../src/knowledge-background-owner.js";
import { runKnowledgeConvergenceCommand } from "../src/knowledge-convergence-command.js";
import { continuityAttentionItems } from "../src/knowledge-continuity-attention.js";
import { continuityRemediation } from "../src/knowledge-continuity-remediation.js";

// The fixture's store already writes schema-4 events, as every delegated resident host does.
const ports = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openProjectStorage: ports.open,
}));

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function host() {
  const f = await fixture(true);
  fixtures.push(f);
  ports.open.mockResolvedValue({ ...f.storage, close: async () => undefined });
  const state = resolve(f.directory, "user-state");
  await mkdir(state, { recursive: true, mode: 0o700 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    cwd: f.root,
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  const run = async (...args: string[]) => {
    stdout.length = 0;
    stderr.length = 0;
    const code = await runKnowledgeConvergenceCommand(args, io);
    return { code, out: stdout.join(""), err: stderr.join("") };
  };
  return { f, state, run };
}

describe("renewal policy command", () => {
  it("plans, applies, shows, and revokes the host policy from the reviewed delegation", async () => {
    const { f, run } = await host();
    expect(JSON.parse((await run("delegation", "renewal-policy", "show")).out)).toEqual({
      status: "absent",
    });
    const plan = await run(
      "delegation",
      "renewal-policy",
      "install",
      "--term-days",
      "14",
      "--json",
    );
    expect(plan.code, plan.err).toBe(0);
    const planned = JSON.parse(plan.out) as {
      status: string;
      policy: { policyId: string; renewal: { termDays: number }; limits: { providers: string[] } };
    };
    expect(planned).toMatchObject({
      status: "review_required",
      policy: { renewal: { termDays: 14 }, limits: { providers: f.delegation!.providers } },
    });
    expect(JSON.parse((await run("delegation", "renewal-policy", "show")).out).status).toBe(
      "absent",
    );
    expect(
      (
        await run(
          "delegation",
          "renewal-policy",
          "install",
          "--term-days",
          "15",
          "--apply",
          planned.policy.policyId,
        )
      ).code,
    ).toBe(1);
    const applied = await run(
      "delegation",
      "renewal-policy",
      "install",
      "--term-days",
      "14",
      "--apply",
      planned.policy.policyId,
    );
    expect(applied.code, applied.err).toBe(0);
    expect(JSON.parse((await run("delegation", "renewal-policy", "show")).out)).toMatchObject({
      status: "loaded",
      policy: {
        policyId: planned.policy.policyId,
        state: "active",
        authority: { kind: "owner_installed" },
      },
    });
    expect(await knowledgeBackgroundOwner(f.root)).toBe("delegation");
    const revoke = JSON.parse((await run("delegation", "renewal-policy", "revoke")).out) as {
      policy: { policyId: string };
    };
    expect(
      (await run("delegation", "renewal-policy", "revoke", "--apply", revoke.policy.policyId)).code,
    ).toBe(0);
    expect(JSON.parse((await run("delegation", "renewal-policy", "show")).out)).toMatchObject({
      policy: { state: "revoked" },
    });
  });
});

describe("continuity doctor", () => {
  it("reports an unreconciled registered checkout, then a reconciled one", async () => {
    const { f, state, run } = await host();
    await registerRepository({
      registryPath: resolve(state, "repositories.json"),
      repositoryRoot: f.root,
    });
    const before = await run("doctor", "--json");
    expect(before.code).toBe(1);
    const report = JSON.parse(before.out) as {
      kind: string;
      repositories: {
        repositoryRoot: string;
        findings: (ContinuityFinding & { remediation: string })[];
      }[];
    };
    expect(report.kind).toBe("knowledge_convergence.doctor");
    expect(report.repositories).toHaveLength(1);
    const codes = report.repositories[0]!.findings.map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining(["continuity_unobserved", "policy_absent"]));
    expect(
      report.repositories[0]!.findings.every((finding) => finding.remediation.length > 20),
    ).toBe(true);

    // ADR-0478: only the convergence owner renews, so this single host observes ownership first.
    expect(
      (await new ConvergenceOwnership({ storage: f.storage, provider: "claude" }).observe()).role,
    ).toBe("owner");
    // One reconciliation adopts the standing policy, renews the due delegation, and records state.
    const seeded = await run("delegation", "seed", "--json");
    expect(seeded.code, seeded.err).toBe(0);
    expect(JSON.parse(seeded.out)).toMatchObject({
      status: "renewed",
      delegation: { state: "active" },
      policy: { state: "active", authority: "owner_instruction" },
    });
    const after = JSON.parse((await run("doctor", "--json")).out) as typeof report;
    const remaining = after.repositories[0]!.findings.map((finding) => finding.code);
    expect(remaining).not.toContain("continuity_unobserved");
    expect(remaining).not.toContain("policy_absent");
    expect(remaining).toContain("owner_host_standalone");
    expect((await run("doctor")).out).toContain("Lervo knowledge continuity:");
  });
});

describe("continuity attention", () => {
  const codes: ContinuityFindingCode[] = [
    "delegation_missing",
    "delegation_expiring",
    "delegation_expired",
    "delegation_revoked",
    "delegation_invalid",
    "delegation_outside_policy",
    "delegation_continuation_failed",
    "policy_absent",
    "policy_invalid",
    "policy_revoked",
    "policy_horizon_near",
    "owner_host_standalone",
    "owner_host_hub_unusable",
    "owner_host_invalid",
    "lease_unverifiable",
    "lease_contended",
    "publication_unavailable",
    "publication_failed",
    "hub_unavailable",
    "peer_delegation_missing",
    "peer_delegation_expiring",
    "peer_unreported",
    "continuity_unobserved",
    "continuity_stale",
    "resident_not_running",
    "hook_runtime_stale",
    "replica_diverged",
  ];

  it("names a remediation for every finding", () => {
    for (const code of codes)
      expect(
        continuityRemediation({ code, severity: "attention", detail: "hub_forbidden" }),
      ).toMatch(/\S{3,}/u);
    expect(
      continuityRemediation({
        code: "owner_host_hub_unusable",
        severity: "attention",
        detail: "hub_forbidden",
      }),
    ).toContain("sync.write");
  });

  it("projects non-blocking items and requires the user only for owner decisions", () => {
    const items = continuityAttentionItems(
      [
        { code: "policy_absent", severity: "info", detail: null },
        { code: "lease_unverifiable", severity: "attention", detail: "hub_forbidden" },
        { code: "delegation_expiring", severity: "owner_decision", detail: "no_policy" },
        { code: "peer_delegation_expiring", severity: "attention", detail: "wsl" },
        { code: "peer_delegation_expiring", severity: "attention", detail: "wsl" },
      ],
      "2026-10-06T00:00:00.000Z",
    );
    expect(items.map((item) => [item.itemId, item.requiresUserAction, item.blocking])).toEqual([
      ["knowledge_convergence_continuity_delegation_expiring_no_policy", true, false],
      ["knowledge_convergence_continuity_peer_delegation_expiring_wsl", false, false],
    ]);
  });
});

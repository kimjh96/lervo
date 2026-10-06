import { loadProjectManifest } from "@lervo/project";
import {
  continuityPeerFindings,
  continuityPeerSummary,
  defaultConvergenceContinuityPolicyPath,
  inspectConvergenceContinuity,
  readConvergenceContinuityPolicy,
  readConvergenceOwnerHost,
  type ContinuityFinding,
  type ContinuityPeerSummary,
} from "@lervo/repository-knowledge-runtime";
import { createHubKnowledgeConvergenceHostClient } from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
} from "@lervo/sync-contract";

import { continuityRemediation } from "./knowledge-continuity-remediation.js";
import { hostRepositoryRoots } from "./knowledge-host-repositories.js";
import { readRepositoryReplicaDivergence } from "./repository-replica-divergence-source.js";
import { inspectTerminalIntegration } from "./upgrade-stage-inspection.js";

export interface ContinuityDoctorFinding extends ContinuityFinding {
  remediation: string;
}

export interface ContinuityDoctorRepository {
  repositoryRoot: string;
  projectId: string | null;
  name: string | null;
  hostLabel: string | null;
  ownerHost: string;
  delegation: { state: string; expiresAt: string | null };
  verdict: { role: string; holderLabel: string | null } | null;
  publication: string | null;
  resident: string | null;
  peers: { source: "hub" | "cached"; hosts: ContinuityPeerSummary[] };
  findings: ContinuityDoctorFinding[];
}

export interface ContinuityDoctorReport {
  schemaVersion: 1;
  kind: "knowledge_convergence.doctor";
  observedAt: string;
  status: "healthy" | "attention" | "owner_decision";
  policy: { state: string; horizonAt: string | null; authority: string | null };
  repositories: ContinuityDoctorRepository[];
  summary: { repositories: number; ownerDecisions: number; attention: number; info: number };
}

/** Live peers through the Hub when this checkout is Hub-coordinated; null keeps cached peers. */
async function livePeers(
  root: string,
): Promise<{ peers: ContinuityPeerSummary[] } | { failureCode: string } | null> {
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  if (host?.config.coordination.mode !== "hub") return null;
  try {
    const manifest = await loadProjectManifest(root);
    const client = await createHubKnowledgeConvergenceHostClient({
      ...host.config.coordination.hub,
      projectId: manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(manifest),
    });
    const records = await client.list(AbortSignal.timeout(15_000));
    return {
      peers: records.filter((item) => item.hostHash !== host.hostHash).map(continuityPeerSummary),
    };
  } catch (error) {
    return { failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode };
  }
}

async function hookRuntime(root: string): Promise<"current" | "stale" | "unknown"> {
  try {
    const { stage } = await inspectTerminalIntegration(root);
    return stage.disposition === "current"
      ? "current"
      : stage.reason === "generated_runtime_only"
        ? "stale"
        : "unknown";
  } catch {
    return "unknown";
  }
}

async function inspectRepository(
  root: string,
  policyPath: string | null,
  now: Date,
): Promise<ContinuityDoctorRepository> {
  const manifest = await loadProjectManifest(root).catch(() => null);
  const replica = await readRepositoryReplicaDivergence(root).catch(() => null);
  const inspection = await inspectConvergenceContinuity({
    repositoryRoot: root,
    policyPath,
    now,
    hookRuntime: await hookRuntime(root),
    replicaDiverged: replica?.status === "observed" && replica.divergence !== null,
  });
  const live = await livePeers(root);
  let findings = inspection.findings;
  let peers: ContinuityDoctorRepository["peers"] = {
    source: "cached",
    hosts: inspection.state?.peers ?? [],
  };
  if (live !== null && "peers" in live) {
    peers = { source: "hub", hosts: live.peers };
    findings = [
      ...findings.filter((finding) => !finding.code.startsWith("peer_")),
      ...continuityPeerFindings(live.peers, now.getTime()),
    ];
  } else if (live !== null)
    findings = [
      ...findings.filter((finding) => finding.code !== "hub_unavailable"),
      { code: "hub_unavailable", severity: "attention", detail: live.failureCode },
    ];
  const delegation = inspection.delegation;
  return {
    repositoryRoot: root,
    projectId: manifest?.projectId ?? null,
    name: manifest?.name ?? null,
    hostLabel: inspection.state?.hostLabel ?? null,
    ownerHost: inspection.state?.ownerHost.state ?? "unobserved",
    delegation: {
      state: delegation.state,
      expiresAt: "expiresAt" in delegation ? delegation.expiresAt : null,
    },
    verdict:
      inspection.verdict === null
        ? null
        : { role: inspection.verdict.role, holderLabel: inspection.verdict.holder?.label ?? null },
    publication: inspection.publicationStatus,
    resident: inspection.resident?.state ?? inspection.resident?.status ?? null,
    peers,
    findings: findings.map((finding) => ({
      ...finding,
      remediation: continuityRemediation(finding),
    })),
  };
}

/**
 * ADR-0469 fleet doctor for this host: every registered repository (plus the current one),
 * each with live delegation, policy, ownership, publication, resident, hook, and replica facts,
 * and its peers as the Hub reports them. Read-only: it changes no file and claims no lease.
 */
export async function inspectContinuityDoctor(input: {
  currentRoot: string | null;
  now?: Date;
}): Promise<ContinuityDoctorReport> {
  const now = input.now ?? new Date();
  const policyPath = defaultConvergenceContinuityPolicyPath();
  const policy =
    policyPath === null
      ? ({ status: "absent" } as const)
      : await readConvergenceContinuityPolicy(policyPath);
  const roots = new Set(await hostRepositoryRoots());
  if (input.currentRoot !== null) roots.add(input.currentRoot);
  const repositories: ContinuityDoctorRepository[] = [];
  for (const root of [...roots].sort())
    repositories.push(await inspectRepository(root, policyPath, now));
  const all = repositories.flatMap((repository) => repository.findings);
  const ownerDecisions = all.filter((finding) => finding.severity === "owner_decision").length;
  const attention = all.filter((finding) => finding.severity === "attention").length;
  return {
    schemaVersion: 1,
    kind: "knowledge_convergence.doctor",
    observedAt: now.toISOString(),
    status: ownerDecisions > 0 ? "owner_decision" : attention > 0 ? "attention" : "healthy",
    policy:
      policy.status === "loaded"
        ? {
            state: policy.policy.state,
            horizonAt: policy.policy.horizonAt,
            authority: policy.policy.authority.kind,
          }
        : { state: policy.status, horizonAt: null, authority: null },
    repositories,
    summary: {
      repositories: repositories.length,
      ownerDecisions,
      attention,
      info: all.length - ownerDecisions - attention,
    },
  };
}

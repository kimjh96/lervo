import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  listDurableInstructionCandidates,
  sha256,
  storeDurableInstructionCandidate,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import { readInstructionCandidateExchangeState } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDurableInstructionCandidate,
  LERVO_INSTRUCTION_SETTLER,
} from "../src/durable-instruction-apply.js";
import { applyStoredInstructionCandidates } from "../src/durable-instruction-auto-apply.js";
import { inspectInstructionCatalog } from "../src/instruction-catalog.js";
import {
  readInstructionCaptureAttention,
  instructionCaptureCompactLines,
} from "../src/instruction-capture-attention.js";
import { runCli } from "../src/main.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const instruction: GroundedDurableInstruction = {
  disposition: "canonical",
  speechAct: "directive",
  authority: "explicit_user",
  durability: "repository",
  operation: "add",
  scope: { kind: "repository", paths: [] },
  title: "Keep both hosts available",
  statement: "Resolve Mac and WSL conflicts without restricting work to one host.",
  exceptions: [],
  risk: "low",
  conflict: "none",
  confidence: "high",
  reasonIds: [],
};

async function hubHost(role: "owner" | "waiting_owner") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-owner-apply-"));
  roots.push(root);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nUse repository knowledge.\n",
  );
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], quiet)).toBe(0);
  const git = (...args: string[]) =>
    execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Owner",
      "-c",
      "user.email=o@lervo.invalid",
      ...args,
    ]);
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("commit", "-q", "-m", "fixture");
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner-host.json"),
    JSON.stringify({
      schemaVersion: 1,
      hostId: `hst_${(role === "owner" ? "b" : "a").repeat(32)}`,
      hostLabel: role === "owner" ? "wsl" : "mac",
      coordination: {
        mode: "hub",
        hub: {
          baseUrl: "https://hub.lervo.invalid",
          bearerTokenFile: "/nonexistent/lervo-hub-token",
          destinationId: "hub-main",
          hubIdentityHash: `sha256:${"9".repeat(64)}`,
        },
      },
    }),
  );
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: {
        role,
        reason: role === "owner" ? "lease_granted" : "convergence_owner_elsewhere",
        mode: "hub",
        hostHash: `sha256:${"1".repeat(64)}`,
        hostLabel: role === "owner" ? "wsl" : "mac",
        holder:
          role === "owner"
            ? null
            : {
                hostHash: `sha256:${"2".repeat(64)}`,
                label: "wsl",
                generation: 3,
                expiresAt: null,
              },
        validUntil: role === "owner" ? new Date(Date.now() + 600_000).toISOString() : null,
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: new Date().toISOString(),
      },
    }),
  );
  const catalog = await inspectInstructionCatalog({
    repositoryRoot: root,
    supplementalSources: [],
  });
  const storage = await openProjectStorage(root);
  const projectId = storage.manifest.projectId;
  await storage.close();
  const plan = await createDurableInstructionPlan({
    repositoryRoot: root,
    projectId,
    requestDigest: sha256("owner turn"),
    resolverResultDigest: `sha256:${"e".repeat(64)}`,
    instruction,
  });
  const candidate = await storeDurableInstructionCandidate({
    repositoryRoot: root,
    candidate: createDurableInstructionCandidate({
      plan,
      provider: "claude",
      sourceSnapshotId: catalog.sourceSnapshotId,
      instruction,
      now: new Date(),
      instructionCatalogDigest: durableInstructionCatalogDigest(
        catalog.semanticCatalog.canonicalInstructions.entries,
      ),
      capture: { source: "terminal_prompt", captureId: `kcap_${"3".repeat(24)}` },
    }),
  });
  return { root, candidate, git };
}

async function storeOwnerStatedCandidate(root: string, statement: GroundedDurableInstruction) {
  const catalog = await inspectInstructionCatalog({
    repositoryRoot: root,
    supplementalSources: [],
  });
  const storage = await openProjectStorage(root);
  const projectId = storage.manifest.projectId;
  await storage.close();
  const plan = await createDurableInstructionPlan({
    repositoryRoot: root,
    projectId,
    requestDigest: sha256(statement.statement!),
    resolverResultDigest: `sha256:${"f".repeat(64)}`,
    instruction: statement,
  });
  return storeDurableInstructionCandidate({
    repositoryRoot: root,
    candidate: createDurableInstructionCandidate({
      plan,
      provider: "claude",
      sourceSnapshotId: catalog.sourceSnapshotId,
      instruction: statement,
      now: new Date(),
      instructionCatalogDigest: durableInstructionCatalogDigest(
        catalog.semanticCatalog.canonicalInstructions.entries,
      ),
      capture: { source: "terminal_prompt", captureId: `kcap_${"4".repeat(24)}` },
    }),
  });
}

describe("applying captured owner rules under the convergence owner lease (ADR-0467)", () => {
  it("refuses apply on a non-owner host and names the owner", async () => {
    const mac = await hubHost("waiting_owner");
    await expect(
      applyDurableInstructionCandidate({
        repositoryRoot: mac.root,
        candidateId: mac.candidate.candidateId,
        now: new Date(),
      }),
    ).rejects.toThrow(
      "The convergence owner host (wsl) receives this rule through the Hub exchange and applies it automatically",
    );
    expect(await listDurableInstructionCandidates(mac.root)).toHaveLength(1);
    const lines = instructionCaptureCompactLines(await readInstructionCaptureAttention(mac.root));
    expect(lines.join("\n")).toContain(
      "1 instruction candidate awaits automatic apply on the convergence owner host (wsl)",
    );
  });

  it("applies on the owner and commits the rule as Lervo Knowledge for publication", async () => {
    const wsl = await hubHost("owner");
    const receipt = await applyDurableInstructionCandidate({
      repositoryRoot: wsl.root,
      candidateId: wsl.candidate.candidateId,
      now: new Date(),
    });
    expect(receipt.commitHash).toMatch(/^[a-f0-9]{40,64}$/u);
    const { stdout: log } = await wsl.git("log", "-1", "--format=%an%n%B");
    expect(log).toContain("Lervo Knowledge");
    expect(log).toContain("docs: apply an owner rule");
    expect(log).toContain(`Lervo-Instruction-Candidate: ${wsl.candidate.candidateId}`);
    expect(log).toContain("Lervo-Convergence-Host:");
    expect(await readFile(resolve(wsl.root, wsl.candidate.targetPath), "utf8")).toContain(
      instruction.statement!,
    );
    expect((await readInstructionCandidateExchangeState(wsl.root)).pendingResolutions).toEqual([
      expect.objectContaining({
        proposedContentHash: wsl.candidate.proposedContentHash,
        resolution: "applied",
      }),
    ]);
  });

  it("commits a replacement and the replaced rule's deletion together", async () => {
    const wsl = await hubHost("owner");
    await applyStoredInstructionCandidates({ repositoryRoot: wsl.root, now: () => new Date() });
    await storeOwnerStatedCandidate(wsl.root, {
      ...instruction,
      authority: "inferred",
      risk: "high",
      conflict: "possible",
      statement: "Resolve Mac and WSL conflicts in the sync mechanism, never by parking a host.",
      replaces: [wsl.candidate.targetPath],
    });
    expect(
      await applyStoredInstructionCandidates({ repositoryRoot: wsl.root, now: () => new Date() }),
    ).toEqual({ applied: 1, deferred: 0 });
    const { stdout } = await wsl.git("show", "--name-status", "--format=%s", "HEAD");
    expect(stdout).toContain("docs: apply an owner rule");
    expect(stdout).toContain(`D\t${wsl.candidate.targetPath}`);
    expect((await wsl.git("status", "--porcelain")).stdout).not.toContain("docs/instructions");
  });
});

describe("applying owner-stated rules without a review command (ADR-0545)", () => {
  it("applies and commits an owner-stated candidate on the convergence owner", async () => {
    const wsl = await hubHost("owner");
    const now = new Date("2026-11-01T00:00:00Z");
    expect(
      await applyStoredInstructionCandidates({ repositoryRoot: wsl.root, now: () => now }),
    ).toEqual({ applied: 1, deferred: 0 });
    expect(await listDurableInstructionCandidates(wsl.root)).toEqual([]);
    expect(await readFile(resolve(wsl.root, wsl.candidate.targetPath), "utf8")).toContain(
      instruction.statement!,
    );
    const { stdout: log } = await wsl.git("log", "-1", "--format=%an%n%B");
    expect(log).toContain("Lervo Knowledge");
    expect(log).toContain(`Lervo-Instruction-Candidate: ${wsl.candidate.candidateId}`);
    const storage = await openProjectStorage(wsl.root);
    try {
      const applied = storage.events
        .list({ limit: 1_000 })
        .filter((event) => event.type === "knowledge.materialization.applied");
      expect(applied).toHaveLength(1);
      expect(applied[0]!.payload.approvalDigest).toBe(
        sha256(
          canonicalJson({
            candidateHash: wsl.candidate.candidateHash,
            candidateId: wsl.candidate.candidateId,
            decision: "apply",
            settledBy: LERVO_INSTRUCTION_SETTLER,
          }),
        ),
      );
    } finally {
      await storage.close();
    }
    expect((await readInstructionCandidateExchangeState(wsl.root)).pendingResolutions).toEqual([
      expect.objectContaining({ resolution: "applied" }),
    ]);
    // A second cycle finds nothing left to apply.
    expect(
      await applyStoredInstructionCandidates({ repositoryRoot: wsl.root, now: () => now }),
    ).toEqual({ applied: 0, deferred: 0 });
  });

  it("leaves candidates untouched on a host that does not own convergence", async () => {
    const mac = await hubHost("waiting_owner");
    expect(
      await applyStoredInstructionCandidates({
        repositoryRoot: mac.root,
        now: () => new Date(),
      }),
    ).toEqual({ applied: 0, deferred: 0 });
    expect(await listDurableInstructionCandidates(mac.root)).toHaveLength(1);
  });

  it("applies a candidate after the instruction catalog changed (ADR-0561)", async () => {
    const wsl = await hubHost("owner");
    await mkdir(resolve(wsl.root, "docs/instructions"), { recursive: true });
    await writeFile(
      resolve(wsl.root, "docs/instructions/review.md"),
      "# Review\n\nReview every change before merge.\n",
    );
    await wsl.git("add", "-A");
    await wsl.git("commit", "-q", "-m", "add an instruction");
    expect(
      await applyStoredInstructionCandidates({
        repositoryRoot: wsl.root,
        now: () => new Date(),
      }),
    ).toEqual({ applied: 1, deferred: 0 });
    expect(await listDurableInstructionCandidates(wsl.root)).toEqual([]);
  });
});

describe("owner-stated rules that arrive together or meet a failed commit (ADR-0545)", () => {
  it("applies two candidates judged against the same catalog in one cycle", async () => {
    const wsl = await hubHost("owner");
    await storeOwnerStatedCandidate(wsl.root, {
      ...instruction,
      title: "Implement directly",
      statement: "Claude implements Lervo changes directly and uses Codex only for review.",
    });
    expect(await listDurableInstructionCandidates(wsl.root)).toHaveLength(2);
    expect(
      await applyStoredInstructionCandidates({
        repositoryRoot: wsl.root,
        now: () => new Date(),
      }),
    ).toEqual({ applied: 2, deferred: 0 });
    expect(await listDurableInstructionCandidates(wsl.root)).toEqual([]);
    const { stdout: log } = await wsl.git("log", "-2", "--format=%an");
    expect(log.trim().split("\n")).toEqual(["Lervo Knowledge", "Lervo Knowledge"]);
  });

  it("keeps the candidate until the rule commit exists, then settles it on retry", async () => {
    const wsl = await hubHost("owner");
    const lock = resolve(wsl.root, ".git/index.lock");
    await writeFile(lock, "");
    expect(
      await applyStoredInstructionCandidates({
        repositoryRoot: wsl.root,
        now: () => new Date(),
      }),
    ).toEqual({ applied: 0, deferred: 1 });
    expect(await listDurableInstructionCandidates(wsl.root)).toHaveLength(1);
    expect((await readInstructionCandidateExchangeState(wsl.root)).pendingResolutions).toEqual([]);
    await rm(lock);
    expect(
      await applyStoredInstructionCandidates({
        repositoryRoot: wsl.root,
        now: () => new Date(),
      }),
    ).toEqual({ applied: 1, deferred: 0 });
    expect(await listDurableInstructionCandidates(wsl.root)).toEqual([]);
    const { stdout: log } = await wsl.git("log", "-1", "--format=%an%n%B");
    expect(log).toContain(`Lervo-Instruction-Candidate: ${wsl.candidate.candidateId}`);
    expect((await readInstructionCandidateExchangeState(wsl.root)).pendingResolutions).toEqual([
      expect.objectContaining({ resolution: "applied" }),
    ]);
  });
});

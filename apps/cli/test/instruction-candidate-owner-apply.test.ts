import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
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
    groundingStatus: "ready",
    catalogComplete: true,
    ambiguityReasons: [],
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

function review(root: string, candidate: { candidateId: string; candidateHash: string }) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return runCli(
    [
      "knowledge",
      "instruction",
      "review",
      candidate.candidateId,
      "--decision",
      "apply",
      "--reviewer",
      "repository-owner",
      "--approval",
      candidate.candidateHash,
      "--json",
    ],
    { cwd: root, stdout: (m) => stdout.push(m), stderr: (m) => stderr.push(m) },
  ).then((code) => ({ code, stdout: stdout.join(""), stderr: stderr.join("") }));
}

describe("applying captured owner rules under the convergence owner lease (ADR-0467)", () => {
  it("refuses apply on a non-owner host and names the owner", async () => {
    const mac = await hubHost("waiting_owner");
    const result = await review(mac.root, mac.candidate);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Apply this candidate on the convergence owner host (wsl)");
    expect(await listDurableInstructionCandidates(mac.root)).toHaveLength(1);
    const lines = instructionCaptureCompactLines(await readInstructionCaptureAttention(mac.root));
    expect(lines.join("\n")).toContain(
      "1 instruction candidate awaits review on the convergence owner host (wsl)",
    );
  });

  it("applies on the owner and commits the rule as Lervo Knowledge for publication", async () => {
    const wsl = await hubHost("owner");
    const result = await review(wsl.root, wsl.candidate);
    expect(result.code, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout) as { commitHash: string | null };
    expect(receipt.commitHash).toMatch(/^[a-f0-9]{40,64}$/u);
    const { stdout: log } = await wsl.git("log", "-1", "--format=%an%n%B");
    expect(log).toContain("Lervo Knowledge");
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
});

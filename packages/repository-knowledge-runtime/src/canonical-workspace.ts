import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, lstat, open, unlink, symlink } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { promisify } from "node:util";
import { readWorkspace, updateWorkspace } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import {
  planWorkspaceProvision,
  applyWorkspaceProvision,
  planWorkspaceSeal,
  applyWorkspaceSeal,
  type ManagedProjectVerification,
} from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { assertConvergenceVerificationPassed } from "./verification-outcome.js";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceEffectCheckpoint } from "./effect-checkpoint.js";
import {
  captureGitKeptSnapshot,
  observedRepositorySnapshot,
  withVerificationSourceChanges,
} from "./verification-source-changes.js";
import { hasCanonicalNormalizationLineage } from "./canonical-normalization-lineage.js";
import { verificationEnvironment } from "./verification-environment.js";

const execute = promisify(execFile);
export async function convergenceGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

async function safeDirectory(root: string, directory: string): Promise<void> {
  const path = relative(root, directory);
  if (path.startsWith("..") || path.startsWith("/"))
    throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  }
}

export async function provisionCanonicalWorkspace(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  kind: "worker" | "integrator",
) {
  const root = context.storage.paths.repositoryRoot;
  const observedBase = await convergenceGit(root, [
    "rev-parse",
    authority.delegation.integrationTarget.ref,
  ]);
  const host = new GitWorkspaceHostAdapter();
  const path = resolve(
    root,
    ".lervo/state/knowledge/convergence-workspaces",
    authority.assignment.assignmentId,
    `lease-${authority.assignment.lease!.generation}`,
    kind,
  );
  await safeDirectory(root, dirname(path));
  const plan = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: `provision:${kind}`,
    prepare: () =>
      planWorkspaceProvision({
        repositoryRoot: root,
        workspacePath: path,
        assignmentId: authority.assignment.assignmentId,
        agentId: authority.agent.agentId,
        leaseId: authority.assignment.lease!.leaseId,
        provider: context.provider,
        baseCommit: observedBase,
        integrationTargetDigest: repositoryCoordinateDigest(
          authority.delegation.integrationTarget.ref,
        ),
        executionKind: kind,
        host,
      }),
  });
  await authority.assertCurrent();
  const stored = await readWorkspace(root, plan.workspace.workspaceId);
  let workspace =
    stored?.workspace.state === "active"
      ? stored.workspace
      : await applyWorkspaceProvision({
          plan,
          host,
          revalidate: () => authority.assertCurrent(),
        });
  const inspection = await host.inspect({
    repositoryRoot: root,
    workspacePath: path,
    baseCommit: plan.baseCommit,
    marker: plan.marker,
  });
  if (
    inspection.status !== "present" ||
    !inspection.markerMatched ||
    inspection.gitOperationInProgress ||
    workspace.assignmentId !== authority.assignment.assignmentId ||
    workspace.leaseGeneration !== authority.assignment.lease!.generation
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const sessionId = authority.assignment.lease!.sessionId;
  if (workspace.state === "ready") {
    const stored = await readWorkspace(root, workspace.workspaceId);
    workspace = (
      await updateWorkspace({
        repositoryRoot: root,
        workspaceId: workspace.workspaceId,
        expectedContentHash: stored!.contentHash,
        eventId: `evt_${sha256([workspace.workspaceId, "activate"].join(":")).slice(7, 39)}`,
        expectedRevision: workspace.revision,
        expectedGeneration: workspace.generation,
        nextState: "active",
        occurredAt: new Date().toISOString(),
        writerSession: { sessionId, startedAt: new Date().toISOString() },
      })
    ).workspace;
  }
  return { path, workspace, host, sessionId, baseCommit: plan.baseCommit };
}

export async function verifyCanonicalWorkspace(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  root: string,
): Promise<ManagedProjectVerification[]> {
  const receipts: ManagedProjectVerification[] = [];
  const environment = await verificationEnvironment();
  for (const required of authority.delegation.verification) {
    await authority.assertCurrent();
    const suite = await loadVerificationSuite(
      context.storage.paths.repositoryRoot,
      required.suiteId,
    );
    const revision = (await captureGitKeptSnapshot(root)).revision;
    const observed = await withVerificationSourceChanges(
      context.storage.artifacts,
      observedRepositorySnapshot,
      (captureRepositoryRevision) =>
        runVerificationSuite(
          {
            suite,
            repositoryRoot: root,
            repositoryRevision: revision,
            captureRepositoryRevision,
            artifactStore: context.storage.artifacts,
            signal: context.signal,
          },
          { environment },
        ),
    );
    assertConvergenceVerificationPassed(observed.result.status);
    receipts.push(observed);
  }
  return receipts;
}

export async function sealCanonicalDrafts(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  authority: ConvergenceAssignmentAuthority,
  drafts: CanonicalDraft[],
  commitIdentity?: {
    name: string;
    email: string;
    subject: string;
    trailers: string;
    deletions?: { path: string; expectedHash: string }[];
    links?: { path: string; target: string }[];
  },
): Promise<{ workspaceId: string; path: string; resultHash: string }> {
  context.assertSourceExact(state);
  const plan = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "seal",
    prepare: async () => {
      const provision = await provisionCanonicalWorkspace(context, authority, "worker");
      const extraPaths: string[] = [];
      for (const deletion of commitIdentity?.deletions ?? []) {
        const bytes = await execute(
          "git",
          ["-C", provision.path, "show", `${provision.baseCommit}:${deletion.path}`],
          { encoding: "buffer", maxBuffer: 8192 },
        );
        if (sha256(bytes.stdout) !== deletion.expectedHash)
          throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
        await safeDirectory(provision.path, dirname(resolve(provision.path, deletion.path)));
        const target = resolve(provision.path, deletion.path);
        if (!(await lstat(target)).isFile())
          throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
        context.assertSourceExact(state);
        await unlink(target);
        extraPaths.push(deletion.path);
      }
      for (const link of commitIdentity?.links ?? []) {
        await safeDirectory(provision.path, dirname(resolve(provision.path, link.path)));
        const target = resolve(dirname(resolve(provision.path, link.path)), link.target);
        if (!target.startsWith(`${provision.path}/`))
          throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
        context.assertSourceExact(state);
        await symlink(link.target, resolve(provision.path, link.path));
        extraPaths.push(link.path);
      }
      for (const draft of drafts) {
        let before: string | null = null;
        try {
          const { stdout } = await execute(
            "git",
            ["-C", provision.path, "show", `${provision.baseCommit}:${draft.path}`],
            { encoding: "buffer", maxBuffer: 256 * 1024 },
          );
          before = sha256(stdout);
        } catch (error) {
          if ((error as { code?: unknown }).code !== 128) throw error;
        }
        if (
          !(await hasCanonicalNormalizationLineage(
            context,
            state,
            draft.path,
            before,
            draft.beforeHash,
          ))
        )
          throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
        await authority.assertCurrent();
        // The draft write and the workspace commit are durable; another writer must refuse them.
        context.assertSourceExact(state);
        await safeDirectory(provision.path, dirname(resolve(provision.path, draft.path)));
        const file = await open(
          resolve(provision.path, draft.path),
          constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(draft.content);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      await convergenceGit(provision.path, [
        "add",
        "-A",
        "--",
        ...drafts.map((draft) => draft.path),
        ...extraPaths,
      ]);
      if (await convergenceGit(provision.path, ["diff", "--cached", "--name-only"]))
        await convergenceGit(provision.path, [
          "-c",
          `user.name=${commitIdentity?.name ?? "Lervo Knowledge Worker"}`,
          "-c",
          `user.email=${commitIdentity?.email ?? "knowledge@lervo.invalid"}`,
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "-m",
          commitIdentity?.subject ?? "docs: apply reviewed canonical knowledge",
          ...(commitIdentity === undefined ? [] : ["-m", commitIdentity.trailers]),
        ]);
      const verifications = await verifyCanonicalWorkspace(context, authority, provision.path);
      const result = await context.storage.artifacts.put(
        canonicalJson({
          schemaVersion: 1,
          obligationId: state.obligationId,
          drafts,
          head: await convergenceGit(provision.path, ["rev-parse", "HEAD"]),
          verifications,
        }),
      );
      await authority.assertCurrent();
      // The seal plan becomes a durable checkpoint that a resumed seal applies.
      context.assertSourceExact(state);
      return planWorkspaceSeal({
        repositoryRoot: context.storage.paths.repositoryRoot,
        workspacePath: provision.path,
        workspaceId: provision.workspace.workspaceId,
        agentId: authority.agent.agentId,
        leaseId: authority.assignment.lease!.leaseId,
        provider: context.provider,
        writerSessionId: provision.sessionId,
        resultArtifactId: `art_${result.contentHash.slice(7, 39)}`,
        resultArtifactHash: result.contentHash,
        verificationResults: verifications.map(({ result, resultArtifact }) => ({
          suiteId: result.suiteId,
          policyHash: result.suiteHash,
          resultArtifactId: resultArtifact.artifactId,
          resultArtifactHash: resultArtifact.contentHash,
          completedAt: result.completedAt,
          passed: result.status === "passed",
        })),
        host: provision.host,
      });
    },
  });
  await authority.assertCurrent();
  context.assertSourceExact(state);
  await applyWorkspaceSeal({ plan, host: new GitWorkspaceHostAdapter() });
  context.sourceObservation?.noteChange();
  return {
    workspaceId: plan.workspaceId,
    path: plan.workspacePath,
    resultHash: plan.sealedResult.resultArtifactHash,
  };
}

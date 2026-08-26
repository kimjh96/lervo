import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadReleaseIntents, releaseDigest } from "./release-intent.mjs";
import { readCurrentReleaseNotes } from "./release-notes.mjs";

const execFile = promisify(execFileCallback);

export class ReleaseTagError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseTagError";
    this.code = code;
  }
}

async function git(repositoryRoot, args, allowFailure = false) {
  try {
    const result = await execFile("git", args, { cwd: repositoryRoot });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    if (allowFailure)
      return {
        ok: false,
        stdout: String(error?.stdout ?? "").trim(),
        stderr: String(error?.stderr ?? "").trim(),
      };
    throw error;
  }
}

async function inspectTag(repositoryRoot, tag) {
  const type = await git(repositoryRoot, ["cat-file", "-t", `refs/tags/${tag}`], true);
  if (!type.ok) return { state: "absent" };
  const commit = await git(repositoryRoot, ["rev-list", "-n", "1", tag]);
  return { state: "present", kind: type.stdout, commit: commit.stdout };
}

export async function createReleaseTagPlan(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const blockers = [];
  const status = await git(repositoryRoot, ["status", "--porcelain"]);
  if (status.stdout !== "") blockers.push("working_tree_not_clean");
  const branch = await git(repositoryRoot, ["branch", "--show-current"]);
  if (branch.stdout !== "main") blockers.push("not_main_branch");
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
  const packageManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
  );
  const version = packageManifest.version;
  if (!/^\d+\.\d+\.\d+$/u.test(version)) blockers.push("package_version_invalid");
  const tag = `v${version}`;
  const releaseNotes = await readCurrentReleaseNotes(repositoryRoot).catch(() => null);
  if (releaseNotes?.package !== "@lervo/cli" || releaseNotes.version !== version)
    blockers.push("release_notes_version_missing");
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"), "utf8"),
  );
  const sbom = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"), "utf8"),
  );
  if (manifest.artifact?.version !== version) blockers.push("release_manifest_version_mismatch");
  if (sbom.metadata?.component?.version !== version) blockers.push("release_sbom_version_mismatch");
  const intents = await loadReleaseIntents(repositoryRoot);
  if (intents.length > 0) blockers.push("release_intent_unconsumed");
  const existing = await inspectTag(repositoryRoot, tag);
  let tagDisposition = "create";
  if (existing.state === "present") {
    if (existing.kind === "tag" && existing.commit === head.stdout) tagDisposition = "current";
    else blockers.push("release_tag_conflict");
  }
  const bindings = {
    head: head.stdout,
    branch: branch.stdout,
    version,
    tag,
    tagDisposition,
    releaseNotesHash: releaseDigest(releaseNotes?.content ?? ""),
    manifestHash: releaseDigest(manifest),
    sbomHash: releaseDigest(sbom),
    blockers,
  };
  return {
    schemaVersion: 1,
    planKind: "cli_release_tag",
    planId: `reltag_${releaseDigest(bindings).slice("sha256:".length, "sha256:".length + 24)}`,
    repositoryRoot,
    status: blockers.length > 0 ? "blocked" : tagDisposition === "current" ? "current" : "ready",
    ...bindings,
    authority: {
      repositoryWrite: false,
      tag: true,
      npmStageApproval: false,
      npmPublication: false,
    },
  };
}

export async function applyReleaseTag(input) {
  if (input.approval !== input.plan.planId)
    throw new ReleaseTagError(
      "release_tag_approval_invalid",
      "Tag approval must equal the exact tag plan ID.",
    );
  const current = await createReleaseTagPlan({ repositoryRoot: input.plan.repositoryRoot });
  if (current.planId !== input.plan.planId)
    throw new ReleaseTagError(
      "release_tag_plan_stale",
      "Release tag inputs changed after planning.",
    );
  if (current.status === "blocked")
    throw new ReleaseTagError(
      "release_tag_blocked",
      `Release tag is blocked: ${current.blockers.join(", ")}.`,
    );
  if (current.status === "ready") {
    const message = `Release @lervo/cli ${current.tag}`;
    try {
      const createTag =
        input.createTag ??
        (() =>
          git(current.repositoryRoot, ["tag", "-a", current.tag, "-m", message, current.head]));
      await createTag({
        repositoryRoot: current.repositoryRoot,
        tag: current.tag,
        message,
        sourceRevision: current.head,
      });
    } catch (_error) {
      const observed = await inspectTag(current.repositoryRoot, current.tag);
      if (
        observed.state !== "present" ||
        observed.kind !== "tag" ||
        observed.commit !== current.head
      )
        throw new ReleaseTagError(
          "release_tag_creation_failed",
          "Annotated tag creation failed without an exact recoverable tag.",
        );
    }
  }
  return {
    schemaVersion: 1,
    receiptKind: "cli_release_tagged",
    planId: current.planId,
    tag: current.tag,
    sourceRevision: current.head,
    disposition: current.status === "current" ? "already_current" : "created",
    workflowHandoff: "cli-release-matrix",
    publication: "not_authorized",
    authority: current.authority,
  };
}

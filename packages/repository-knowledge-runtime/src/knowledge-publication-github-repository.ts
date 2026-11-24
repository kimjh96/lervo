import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import { toolEnvironment } from "./tool-environment.js";

const execute = promisify(execFile);

/**
 * ADR-0607: the GitHub repository a publication targets is the one its configured remote names,
 * on github.com or a GitHub Enterprise Server host. gh would otherwise pick its own default
 * repository and host, which in a fork clone, a checkout with several remotes, or behind an SSH
 * host alias can be another repository.
 */

const NAME = /^[A-Za-z0-9_.-]+$/u;
const HOST = /^[A-Za-z0-9.-]+$/u;
const URL_FORM =
  /^(?<scheme>https?|ssh|git):\/\/(?:[^@/]+@)?(?<host>[^/:\s]+)(?::\d+)?\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?\/?$/u;
const SCP_FORM =
  /^(?:[^@\s/]+@)?(?<host>[^:/\s]+):(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?\/?$/u;

export interface GitHubRemote {
  host: string;
  owner: string;
  name: string;
  /** Whether the host is an SSH host, which may be an alias for another one. */
  ssh: boolean;
}

/** The host, owner and name a remote URL names, or null for a local path or anything else. */
export function parseGitHubRemoteUrl(url: string): GitHubRemote | null {
  const text = url.trim();
  const match = URL_FORM.exec(text);
  const scp = match === null && !text.includes("://") ? SCP_FORM.exec(text) : null;
  const groups = (match ?? scp)?.groups;
  if (groups === undefined) return null;
  const { host, owner, name } = groups as { host: string; owner: string; name: string };
  if (!HOST.test(host) || !NAME.test(owner) || !NAME.test(name) || name === "." || name === "..")
    return null;
  return {
    host: host.toLowerCase(),
    owner,
    name,
    ssh: scp !== null || groups.scheme === "ssh",
  };
}

/** `owner/name` on github.com, `host/owner/name` on any other GitHub host. */
export function formatGitHubRepository(remote: { host: string; owner: string; name: string }) {
  return remote.host === "github.com"
    ? `${remote.owner}/${remote.name}`
    : `${remote.host}/${remote.owner}/${remote.name}`;
}

export class GitHubRepositoryUnresolved extends Error {
  override name = "GitHubRepositoryUnresolved";
}

/** GitHub's SSH-over-HTTPS endpoint, often configured as an alias on port 443. */
const GITHUB_SSH_HOSTS = new Set(["github.com", "ssh.github.com"]);
const SSH_TIMEOUT_MS = 5_000;
const GH_TIMEOUT_MS = 15_000;

/** Whether gh is logged in to `host`, so that `--hostname host` can work. */
async function ghKnowsHost(host: string, executable = "gh"): Promise<boolean> {
  const { environment } = await toolEnvironment();
  return execute(executable, ["auth", "status", "--hostname", host], {
    timeout: GH_TIMEOUT_MS,
    env: { ...environment, GH_PROMPT_DISABLED: "1" },
  }).then(
    () => true,
    () => false,
  );
}

/**
 * The GitHub host behind an SSH host alias, from `ssh -G`, which reads the SSH configuration and
 * connects to nothing. `ssh.github.com`, GitHub's endpoint on port 443, is github.com. Any other
 * resolved host, such as an IP address or an internal name, counts only when gh knows it;
 * otherwise the alias is kept as written, and gh refuses it visibly.
 */
async function sshHostname(
  alias: string,
  options: ResolveGitHubRepositoryOptions,
): Promise<{ host: string; provisional: boolean }> {
  const output = await execute(
    "ssh",
    [...(options.sshConfig === undefined ? [] : ["-F", options.sshConfig]), "-G", "--", alias],
    { timeout: SSH_TIMEOUT_MS },
  ).then(
    ({ stdout }) => stdout,
    () => "",
  );
  const hostname = /^hostname\s+(\S+)$/mu.exec(output)?.[1]?.toLowerCase();
  // Unreadable SSH configuration leaves the host as written, and GitHub's own SSH hosts are
  // github.com whether or not ssh could say so.
  const written = GITHUB_SSH_HOSTS.has(alias) ? "github.com" : alias;
  if (hostname === undefined || !HOST.test(hostname)) return { host: written, provisional: false };
  if (GITHUB_SSH_HOSTS.has(hostname)) return { host: "github.com", provisional: false };
  if (hostname === alias) return { host: alias, provisional: false };
  const knowsHost =
    options.knowsHost ?? ((host: string) => ghKnowsHost(host, options.executable ?? "gh"));
  // A gh that does not know the host now may only be offline or logged out for a while, so the
  // alias it leaves is provisional and is resolved again later.
  return (await knowsHost(hostname))
    ? { host: hostname, provisional: false }
    : { host: alias, provisional: true };
}

export interface ResolveGitHubRepositoryOptions {
  sshConfig?: string;
  /** The gh executable whose login decides an SSH alias's host. */
  executable?: string;
  knowsHost?: (host: string) => Promise<boolean>;
}

/** A resolved repository; a provisional one kept an alias gh did not know, and is resolved again. */
export interface ResolvedGitHubRepository {
  repository: string;
  provisional: boolean;
}

/** The repository of the publication remote, read from the owner host's publication settings. */
export async function resolveGitHubRepository(
  root: string,
  options: ResolveGitHubRepositoryOptions = {},
): Promise<string> {
  return (await resolveGitHubRepositoryDetail(root, options)).repository;
}

/** `resolveGitHubRepository`, saying whether the answer is provisional. */
export async function resolveGitHubRepositoryDetail(
  root: string,
  options: ResolveGitHubRepositoryOptions = {},
): Promise<ResolvedGitHubRepository> {
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  const remote = host?.config.publication?.remote ?? "origin";
  // A remote name that could read as an option is no remote.
  const url = await (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(remote)
      ? execute("git", ["-C", root, "remote", "get-url", remote])
      : Promise.reject<{ stdout: string }>(new Error("invalid remote"))
  ).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  );
  const parsed = parseGitHubRemoteUrl(url);
  if (parsed === null)
    throw new GitHubRepositoryUnresolved(
      `the publication remote ${remote} names no GitHub repository`,
    );
  const resolved = parsed.ssh
    ? await sshHostname(parsed.host, options)
    : { host: parsed.host === "ssh.github.com" ? "github.com" : parsed.host, provisional: false };
  return {
    repository: formatGitHubRepository({ ...parsed, host: resolved.host }),
    provisional: resolved.provisional,
  };
}

/** How long a provisional repository answer is used before it is resolved again. */
const PROVISIONAL_REPOSITORY_MS = 5 * 60_000;

/**
 * ADR-0607: the repository every gh call of one forge targets, resolved on first use. A failed
 * resolution is tried again on the next call, so a remote fixed later is read; a provisional answer
 * is used for five minutes and then resolved again, never kept for the resident's lifetime. A
 * `fixed` repository, or null for gh's own resolution, is never resolved.
 */
export function githubRepositoryOnce(input: {
  root: string;
  fixed: string | null | undefined;
  resolve: (root: string) => Promise<ResolvedGitHubRepository>;
  now: () => Date;
}): () => Promise<string | null> {
  if (input.fixed !== undefined) {
    const fixed = Promise.resolve(input.fixed);
    return () => fixed;
  }
  let resolved: Promise<string> | null = null;
  let provisionalUntil: number | null = null;
  return () => {
    if (provisionalUntil !== null && input.now().getTime() >= provisionalUntil) {
      resolved = null;
      provisionalUntil = null;
    }
    resolved ??= input.resolve(input.root).then(
      (answer) => {
        provisionalUntil = answer.provisional
          ? input.now().getTime() + PROVISIONAL_REPOSITORY_MS
          : null;
        return answer.repository;
      },
      (error: unknown) => {
        resolved = null;
        throw error;
      },
    );
    return resolved;
  };
}

/**
 * The gh arguments for one repository: `{owner}` and `{repo}` in `gh api` endpoints and fields
 * are filled in, since `gh api` has no `--repo`, with `--hostname` off github.com; every other
 * command gets `--repo`, which carries the host.
 */
export function scopeGitHubArguments(args: readonly string[], repository: string): string[] {
  const parts = repository.split("/");
  const [host, owner, name] = (parts.length === 3 ? parts : ["github.com", ...parts]) as [
    string,
    string,
    string,
  ];
  if (args[0] === "api") {
    const filled = args.map((arg) => arg.replaceAll("{owner}", owner).replaceAll("{repo}", name));
    return host === "github.com" ? filled : ["api", "--hostname", host, ...filled.slice(1)];
  }
  return [...args, "--repo", repository];
}

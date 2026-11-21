import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";
import { createGitHubKnowledgePublicationForge } from "../src/knowledge-publication-github.js";
import {
  formatGitHubRepository,
  githubRepositoryOnce,
  parseGitHubRemoteUrl,
  resolveGitHubRepository,
  resolveGitHubRepositoryDetail,
  scopeGitHubArguments,
} from "../src/knowledge-publication-github-repository.js";
import { git, setup } from "./knowledge-publication-fixture.js";

/** ADR-0603: every gh call targets the repository the publication remote names. */

describe("the publication's GitHub repository (ADR-0603)", () => {
  it("reads host, owner and name from every remote form, and nothing else", () => {
    const repository = (url: string) => {
      const parsed = parseGitHubRemoteUrl(url);
      return parsed === null ? null : formatGitHubRepository(parsed);
    };
    for (const url of [
      "https://github.com/kimjh96/lervo.git",
      "https://token@github.com/kimjh96/lervo",
      "git@github.com:kimjh96/lervo.git",
      "ssh://git@github.com/kimjh96/lervo.git",
      "ssh://git@github.com:22/kimjh96/lervo/",
    ])
      expect(repository(url), url).toBe("kimjh96/lervo");
    // GitHub Enterprise Server: the host is part of the repository.
    expect(repository("https://ghe.example.com/platform/lervo.git")).toBe(
      "ghe.example.com/platform/lervo",
    );
    expect(repository("git@ghe.example.com:platform/lervo.git")).toBe(
      "ghe.example.com/platform/lervo",
    );
    expect(parseGitHubRemoteUrl("gh-work:kimjh96/lervo.git")).toMatchObject({
      host: "gh-work",
      ssh: true,
    });
    for (const url of [
      "/srv/git/lervo.git",
      "https://github.com/kimjh96",
      "git@github.com:a/../b.git",
    ])
      expect(repository(url), url).toBeNull();
  });

  it(
    "resolves an SSH host alias and a GHES remote to the host gh must target",
    { timeout: 60_000 },
    async () => {
      const { root } = await setup();
      const sshConfig = resolve(root, "..", "ssh-config");
      // A work alias for github.com, and one for an enterprise host.
      await writeFile(
        sshConfig,
        [
          "Host gh-work",
          "  HostName github.com",
          "Host gh443",
          "  HostName ssh.github.com",
          "  Port 443",
          "Host ghe",
          "  HostName ghe.example.com",
          "Host gh-ip",
          "  HostName 10.20.30.40",
          "",
        ].join("\n"),
      );
      // gh knows github.com and the enterprise host, and nothing at an IP address.
      const knowsHost = async (host: string) => host === "ghe.example.com";
      const resolveWith = async (url: string) => {
        await git(root, ["remote", "set-url", "origin", url]);
        return resolveGitHubRepository(root, { sshConfig, knowsHost });
      };
      expect(await resolveWith("gh-work:kimjh96/lervo.git")).toBe("kimjh96/lervo");
      // GitHub's SSH endpoint on port 443 is github.com.
      expect(await resolveWith("gh443:kimjh96/lervo.git")).toBe("kimjh96/lervo");
      expect(await resolveWith("ssh://git@ssh.github.com:443/kimjh96/lervo.git")).toBe(
        "kimjh96/lervo",
      );
      expect(await resolveWith("git@ghe:platform/lervo.git")).toBe(
        "ghe.example.com/platform/lervo",
      );
      // An IP address gh does not know keeps the alias, so gh refuses it visibly.
      expect(await resolveWith("gh-ip:platform/lervo.git")).toBe("gh-ip/platform/lervo");
      // gh targets that host: `--hostname` for the API, `--repo HOST/OWNER/NAME` otherwise.
      expect(
        scopeGitHubArguments(
          ["api", "repos/{owner}/{repo}/pulls"],
          "ghe.example.com/platform/lervo",
        ),
      ).toEqual(["api", "--hostname", "ghe.example.com", "repos/platform/lervo/pulls"]);
      expect(scopeGitHubArguments(["pr", "view", "1"], "ghe.example.com/platform/lervo")).toEqual([
        "pr",
        "view",
        "1",
        "--repo",
        "ghe.example.com/platform/lervo",
      ]);
    },
  );

  it(
    "maps GitHub's own SSH hosts even when ssh cannot read its configuration",
    { timeout: 60_000 },
    async () => {
      const { root } = await setup();
      // `ssh -G` fails on an unreadable configuration file.
      const sshConfig = resolve(root, "..", "missing-ssh-config");
      for (const url of ["git@ssh.github.com:kimjh96/lervo.git", "ssh.github.com:kimjh96/lervo"]) {
        await git(root, ["remote", "set-url", "origin", url]);
        await expect(resolveGitHubRepositoryDetail(root, { sshConfig }), url).resolves.toEqual({
          repository: "kimjh96/lervo",
          provisional: false,
        });
      }
      // Any other alias stays as written, and is not provisional: nothing was asked of gh.
      await git(root, ["remote", "set-url", "origin", "gh-work:kimjh96/lervo.git"]);
      await expect(resolveGitHubRepositoryDetail(root, { sshConfig })).resolves.toEqual({
        repository: "gh-work/kimjh96/lervo",
        provisional: false,
      });
    },
  );

  it(
    "resolves an alias gh did not know again later, and keeps a settled answer",
    { timeout: 60_000 },
    async () => {
      const { root } = await setup();
      const sshConfig = resolve(root, "..", "ghe-ssh-config");
      await writeFile(sshConfig, "Host ghe\n  HostName ghe.example.com\n");
      await git(root, ["remote", "set-url", "origin", "git@ghe:platform/lervo.git"]);
      // gh is logged out for a while, then logged in again.
      let loggedIn = false;
      const knowsHost = async () => loggedIn;
      await expect(resolveGitHubRepositoryDetail(root, { sshConfig, knowsHost })).resolves.toEqual({
        repository: "ghe/platform/lervo",
        provisional: true,
      });
      let at = Date.parse("2026-11-21T00:00:00.000Z");
      let calls = 0;
      const repository = githubRepositoryOnce({
        root,
        fixed: undefined,
        resolve: (path) => {
          calls += 1;
          return resolveGitHubRepositoryDetail(path, { sshConfig, knowsHost });
        },
        now: () => new Date(at),
      });
      expect(await repository()).toBe("ghe/platform/lervo");
      loggedIn = true;
      at += 60_000;
      // Within five minutes the provisional answer stands; after them it is resolved again.
      expect(await repository()).toBe("ghe/platform/lervo");
      at += 5 * 60_000;
      expect(await repository()).toBe("ghe.example.com/platform/lervo");
      at += 60 * 60_000;
      expect(await repository()).toBe("ghe.example.com/platform/lervo");
      expect(calls).toBe(2);
      // A failed resolution is tried again on the next call.
      let failures = 1;
      const retried = githubRepositoryOnce({
        root,
        fixed: undefined,
        resolve: async () => {
          if (failures-- > 0) throw new Error("remote unreadable");
          return { repository: "kimjh96/lervo", provisional: false };
        },
        now: () => new Date(at),
      });
      await expect(retried()).rejects.toThrow(/remote unreadable/u);
      await expect(retried()).resolves.toBe("kimjh96/lervo");
    },
  );

  it(
    "follows publication.remote in a fork clone, not gh's default repository",
    { timeout: 60_000 },
    async () => {
      const { root } = await setup();
      // A fork clone: origin is the fork, and the publication targets the upstream.
      await git(root, ["remote", "set-url", "origin", "git@github.com:someone/lervo-fork.git"]);
      await git(root, ["remote", "add", "upstream", "https://github.com/kimjh96/lervo.git"]);
      const hostPath = resolve(root, CONVERGENCE_OWNER_HOST_PATH);
      const host = JSON.parse(await readFile(hostPath, "utf8")) as {
        publication: { remote: string };
      };
      const sshConfig = resolve(root, "..", "empty-ssh-config");
      await writeFile(sshConfig, "");
      await expect(resolveGitHubRepository(root, { sshConfig })).resolves.toBe(
        "someone/lervo-fork",
      );
      host.publication.remote = "upstream";
      await writeFile(hostPath, JSON.stringify(host));
      await expect(resolveGitHubRepository(root, { sshConfig })).resolves.toBe("kimjh96/lervo");
      // A remote that names no GitHub repository refuses, by name, before any gh call.
      host.publication.remote = "missing";
      await writeFile(hostPath, JSON.stringify(host));
      // The executable does not exist: a gh call would fail as not installed, not as not found.
      const forge = createGitHubKnowledgePublicationForge({
        repositoryRoot: root,
        executable: resolve(root, "no-gh-here"),
      });
      await expect(forge.viewPullRequest(1)).rejects.toMatchObject({
        failureClass: "not_found",
        reason: "the publication remote missing names no GitHub repository",
      });
    },
  );

  it("scopes every gh call and never adopts a fork's pull request", async () => {
    expect(
      scopeGitHubArguments(
        ["api", "repos/{owner}/{repo}/pulls?head={owner}:b", "-F", "owner={owner}"],
        "kimjh96/lervo",
      ),
    ).toEqual(["api", "repos/kimjh96/lervo/pulls?head=kimjh96:b", "-F", "owner=kimjh96"]);
    expect(scopeGitHubArguments(["pr", "view", "1"], "kimjh96/lervo")).toEqual([
      "pr",
      "view",
      "1",
      "--repo",
      "kimjh96/lervo",
    ]);
    const calls: string[][] = [];
    const pull = (number: number, cross: boolean, owner: string) => ({
      number,
      url: `https://github.com/kimjh96/lervo/pull/${number}`,
      state: "OPEN",
      headRefOid: "a".repeat(40),
      title: "t",
      body: "",
      mergeCommit: null,
      isCrossRepository: cross,
      headRepositoryOwner: { login: owner },
    });
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      repository: "kimjh96/lervo",
      run: async (args) => {
        calls.push(args);
        if (args[1] === "list")
          return JSON.stringify([pull(9, true, "someone"), pull(7, false, "kimjh96")]);
        return "";
      },
    });
    await expect(
      forge.findPullRequest({ head: "lervo/knowledge-outputs", base: "main" }),
    ).resolves.toMatchObject({ number: 7 });
    expect(calls[0]!.slice(-2)).toEqual(["--repo", "kimjh96/lervo"]);
    await forge.merge({ number: 7, headSha: "a".repeat(40), method: "merge" });
    expect(calls.at(-1)).toEqual([
      "pr",
      "merge",
      "7",
      "--merge",
      "--match-head-commit",
      "a".repeat(40),
      "--repo",
      "kimjh96/lervo",
    ]);
  });

  it("reads gh's real history page by page, and stops at an incremental read's bound", async () => {
    // Captured with `gh api ... sort=updated&per_page=30&page=N` against kimjh96/lervo on 2026-11-21.
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        readFile(
          resolve(import.meta.dirname, `fixtures/github-publication-history-page-${page}.jsonl`),
          "utf8",
        ),
      ),
    );
    const calls: string[][] = [];
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      repository: "kimjh96/lervo",
      historyPageSize: 30,
      run: async (args) => {
        calls.push(args);
        const page = Number(/[?&]page=(\d+)/u.exec(args[1]!)?.[1]);
        return pages[page - 1] ?? "";
      },
    });
    const history = await forge.publicationHistory({
      head: "lervo/knowledge-outputs",
      base: "main",
    });
    expect(calls).toHaveLength(3);
    expect(history).toHaveLength(70);
    expect(new Set(history.map((entry) => entry.number)).size).toBe(70);
    expect(history.filter((entry) => entry.merged)).toHaveLength(63);
    // An unmerged pull request's test merge commit is never read as a merge.
    expect(
      history.filter((entry) => !entry.merged).every((entry) => entry.mergeCommit === null),
    ).toBe(true);
    expect(calls[0]![1]).toBe(
      "repos/kimjh96/lervo/pulls?state=all&head=kimjh96:lervo%2Fknowledge-outputs&base=main&sort=updated&direction=desc&per_page=30&page=1",
    );
    // An incremental read stops at the first page that reaches back past its bound.
    calls.length = 0;
    const since = history[29]!.updatedAt;
    await forge.publicationHistory({ head: "lervo/knowledge-outputs", base: "main", since });
    expect(calls.length).toBeLessThan(3);
  });
});

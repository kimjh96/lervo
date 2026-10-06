import { describe, expect, it } from "vitest";

import { probeKnowledgePublicationSettings } from "../src/knowledge-publication-readiness.js";

function runner(advertised: string | null, options: { gh?: boolean } = {}) {
  const calls: string[][] = [];
  return {
    calls,
    run: async (executable: string, args: string[]) => {
      calls.push([executable, ...args]);
      if (executable === "gh") return options.gh === false ? null : "Logged in\n";
      if (args[0] === "remote") return "git@github.com:owner/repository.git\n";
      if (args[0] === "ls-remote") return advertised;
      // Any other Git read, such as the local origin/HEAD, must not decide the base.
      return "origin/fix/home-data-freshness\n";
    },
  };
}

describe("knowledge publication readiness probe", () => {
  it("targets the default branch the remote advertises, with the delegation scope", async () => {
    const fake = runner(
      "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n",
    );
    expect(
      await probeKnowledgePublicationSettings({ repositoryRoot: "/repository", runner: fake.run }),
    ).toEqual({
      remote: "origin",
      baseBranch: "main",
      branch: "lervo/knowledge-outputs",
      merge: "when_checks_pass",
      scope: "delegation",
    });
    expect(fake.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
      "git remote",
      "git ls-remote",
      "gh auth",
    ]);
  });

  it("stays unavailable when the remote does not advertise its default branch", async () => {
    for (const advertised of [null, "", "0123456789abcdef0123456789abcdef01234567\tHEAD\n"])
      expect(
        await probeKnowledgePublicationSettings({
          repositoryRoot: "/repository",
          runner: runner(advertised).run,
        }),
      ).toBeNull();
  });

  it("refuses a remote whose default is the publication branch, and a host without gh", async () => {
    expect(
      await probeKnowledgePublicationSettings({
        repositoryRoot: "/repository",
        runner: runner("ref: refs/heads/lervo/knowledge-outputs\tHEAD\n").run,
      }),
    ).toBeNull();
    expect(
      await probeKnowledgePublicationSettings({
        repositoryRoot: "/repository",
        runner: runner("ref: refs/heads/main\tHEAD\n", { gh: false }).run,
      }),
    ).toBeNull();
  });
});

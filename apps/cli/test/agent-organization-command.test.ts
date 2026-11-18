import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function io(cwd: string, stdout: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: () => undefined,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent organization CLI", () => {
  it("reclassifies an exact existing team with an auditable revision", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-team-kind-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "team-kind"], io(root))).toBe(0);
    const coordinates = [
      "--organization",
      "org_lervoowner01",
      "--team",
      "team_lervocore01",
      "--root",
      root,
    ];
    expect(
      await runCli(
        ["organization", "bind-team", ...coordinates, "--kind", "project", "--write"],
        io(root),
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["organization", "set-team-kind", ...coordinates, "--kind", "central", "--write"],
        io(root),
      ),
    ).toBe(0);
    const output: string[] = [];
    expect(
      await runCli(["organization", "inspect", "--root", root, "--json"], io(root, output)),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      team: { organizationId: "org_lervoowner01", teamKind: "central" },
      teamKindRevision: 2,
    });
  });
});

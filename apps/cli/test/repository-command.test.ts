import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

function io(cwd: string, stdout: string[], stderr: string[]) {
  return { cwd, stdout: (message: string) => stdout.push(message), stderr: (message: string) => stderr.push(message) };
}

describe("repository selection command", () => {
  it("requires write authorization, stores locally, and revalidates on resolve", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-repository-"));
    const repository = resolve(root, "repository");
    const registry = resolve(root, "state/repositories.json");
    await mkdir(repository);
    expect(await runCli(["init", "--root", repository, "--name", "fixture"], io(root, [], []))).toBe(0);

    const unauthorizedErrors: string[] = [];
    expect(await runCli(["repository", "register", "--root", repository, "--registry", registry], io(root, [], unauthorizedErrors))).toBe(1);
    expect(unauthorizedErrors.join("")).toContain("repository_write_required");

    const registeredOutput: string[] = [];
    expect(await runCli(["repository", "register", "--root", repository, "--registry", registry, "--write", "--json"], io(root, registeredOutput, []))).toBe(0);
    const registration = JSON.parse(registeredOutput.join("")).registration;
    expect(registration).toMatchObject({ name: "fixture", repositoryRoot: await realpath(repository) });

    const listOutput: string[] = [];
    expect(await runCli(["repository", "list", "--registry", registry, "--json"], io(root, listOutput, []))).toBe(0);
    expect(JSON.parse(listOutput.join(""))).toMatchObject({ verification: "stored_only", repositories: [{ projectId: registration.projectId }] });

    const resolvedOutput: string[] = [];
    expect(await runCli(["repository", "resolve", "--project", registration.projectId, "--registry", registry, "--json"], io(root, resolvedOutput, []))).toBe(0);
    expect(JSON.parse(resolvedOutput.join(""))).toMatchObject({ verification: "manifest_revalidated", registration: { projectId: registration.projectId } });

    const manifestPath = resolve(repository, ".lervo/project.yaml");
    await writeFile(manifestPath, (await readFile(manifestPath, "utf8")).replace("name: fixture", "name: changed"));
    const staleErrors: string[] = [];
    expect(await runCli(["repository", "resolve", "--project", registration.projectId, "--registry", registry], io(root, [], staleErrors))).toBe(1);
    expect(staleErrors.join("")).toContain("repository_registration_stale");
  });
});

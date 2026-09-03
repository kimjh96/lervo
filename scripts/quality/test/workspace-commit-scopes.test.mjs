import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import commitlintConfig from "../../../commitlint.config.js";
import { workspaceCommitScopes } from "../lib/workspace-commit-scopes.mjs";

describe("workspace commit scopes", () => {
  it("derives sorted package scopes used by commitlint", () => {
    const scopes = workspaceCommitScopes();
    assert.ok(scopes.includes("cli"));
    assert.ok(scopes.includes("node-runtime"));
    assert.ok(scopes.includes("repository-knowledge"));
    assert.deepEqual(scopes, [...scopes].sort());
    assert.equal(new Set(scopes).size, scopes.length);
    assert.deepEqual(commitlintConfig.rules["scope-enum"], [2, "always", scopes]);
  });

  it("rejects non-Lervo names and unsupported workspace patterns", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-commit-scopes-"));
    await mkdir(resolve(root, "packages/example"), { recursive: true });
    await writeFile(resolve(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(resolve(root, "packages/example/package.json"), '{"name":"example"}\n');
    assert.throws(() => workspaceCommitScopes(root), /@lervo/u);
    await writeFile(resolve(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    assert.throws(() => workspaceCommitScopes(root), /Unsupported workspace package pattern/u);
  });
});

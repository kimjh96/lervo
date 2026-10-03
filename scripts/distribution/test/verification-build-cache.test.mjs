import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, it } from "vitest";

import {
  isVerificationBuildInput,
  recordVerificationBuild,
  verificationBuildCurrent,
  verificationBuildInputDigest,
} from "../lib/verification-build-cache.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository() {
  const root = mkdtempSync(resolve(tmpdir(), "lervo-verification-build-"));
  roots.push(root);
  execFileSync("git", ["-C", root, "init", "-q"]);
  mkdirSync(resolve(root, "src"));
  mkdirSync(resolve(root, "docs"));
  mkdirSync(resolve(root, "dist"));
  writeFileSync(resolve(root, ".gitignore"), "dist/\nnode_modules/\n");
  writeFileSync(resolve(root, "src/index.ts"), "export const value = 1;\n");
  writeFileSync(resolve(root, "docs/guide.md"), "# Guide\n");
  writeFileSync(resolve(root, "dist/index.js"), "export const value = 1;\n");
  return root;
}

describe("verification build reuse", () => {
  it("excludes documentation and private Lervo state from build inputs", () => {
    assert.equal(isVerificationBuildInput("packages/core/src/index.ts"), true);
    assert.equal(isVerificationBuildInput("pnpm-lock.yaml"), true);
    assert.equal(isVerificationBuildInput("docs/specs/runtime.md"), false);
    assert.equal(isVerificationBuildInput("packages/core/README.md"), false);
    assert.equal(isVerificationBuildInput(".lervo/knowledge/policy.yaml"), false);
  });

  it("reuses a recorded build after documentation edits and rebuilds after source edits", () => {
    const root = repository();
    const digest = verificationBuildInputDigest(root);
    assert.equal(verificationBuildCurrent(root, digest, ["dist/index.js"]), false);
    recordVerificationBuild(root, digest);
    writeFileSync(resolve(root, "docs/guide.md"), "# Guide\n\nEdited.\n");
    assert.equal(verificationBuildInputDigest(root), digest);
    assert.equal(verificationBuildCurrent(root, digest, ["dist/index.js"]), true);
    assert.equal(verificationBuildCurrent(root, digest, ["dist/missing.js"]), false);
    writeFileSync(resolve(root, "src/index.ts"), "export const value = 2;\n");
    const changed = verificationBuildInputDigest(root);
    assert.notEqual(changed, digest);
    assert.equal(verificationBuildCurrent(root, changed, ["dist/index.js"]), false);
  });
});

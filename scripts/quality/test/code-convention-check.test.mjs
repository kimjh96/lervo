import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { inspectCodeConventionReviews } from "../check-code-convention.mjs";

const temporaryRoots = [];

async function fixture(review) {
  const root = await mkdtemp(join(tmpdir(), "lervo-code-convention-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "apps"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  const source = `${Array.from({ length: 400 }, (_, index) => `export const value${index} = ${index};`).join("\n")}\n`;
  await writeFile(join(root, "apps/large.ts"), source);
  await writeFile(
    join(root, "scripts/code-convention-reviews.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        reviewLineThreshold: 400,
        reviews: review(source),
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("code-convention structural review", () => {
  it("accepts an exact-hash review for a long production module", async () => {
    const root = await fixture((source) => [
      {
        path: "apps/large.ts",
        contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
        responsibility: "A single generated fixture boundary",
        rationale: "The declaration catalog is cohesive and has no independent executable concern.",
        disposition: "cohesive",
      },
    ]);
    const result = await inspectCodeConventionReviews({ repositoryRoot: root });
    expect(result.issues).toEqual([]);
  });

  it("rejects a missing review", async () => {
    const root = await fixture(() => []);
    const result = await inspectCodeConventionReviews({ repositoryRoot: root });
    expect(result.issues).toContain("apps/large.ts reached 400 lines without a structural review.");
  });

  it("rejects a stale content hash", async () => {
    const root = await fixture(() => [
      {
        path: "apps/large.ts",
        contentHash: `sha256:${"0".repeat(64)}`,
        responsibility: "A single generated fixture boundary",
        rationale: "The declaration catalog is cohesive and has no independent executable concern.",
        disposition: "cohesive",
      },
    ]);
    const result = await inspectCodeConventionReviews({ repositoryRoot: root });
    expect(result.issues).toContain("apps/large.ts changed after its structural review.");
  });

  it("reviews long Rust modules and skips the Cargo target directory", async () => {
    const root = await fixture((source) => [
      {
        path: "apps/large.ts",
        contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
        responsibility: "A single generated fixture boundary",
        rationale: "The declaration catalog is cohesive and has no independent executable concern.",
        disposition: "cohesive",
      },
    ]);
    const rust = `${Array.from({ length: 400 }, (_, index) => `const VALUE_${index}: u32 = ${index};`).join("\n")}\n`;
    await mkdir(join(root, "apps/ade/session-host/src"), { recursive: true });
    await mkdir(join(root, "apps/ade/target/debug/build/out"), { recursive: true });
    await writeFile(join(root, "apps/ade/session-host/src/large.rs"), rust);
    await writeFile(join(root, "apps/ade/target/debug/build/out/generated.rs"), rust);
    const result = await inspectCodeConventionReviews({ repositoryRoot: root });
    expect(result.issues).toEqual([
      "apps/ade/session-host/src/large.rs reached 400 lines without a structural review.",
    ]);
  });
});

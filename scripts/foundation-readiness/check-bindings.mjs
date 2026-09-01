import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const foundationFocusedSuites = Object.freeze({
  contracts: Object.freeze([
    "packages/schemas/test/event-compatibility.test.ts",
    "packages/event-contract/test/event-reader.test.ts",
    "packages/event-contract/test/event-reader-capabilities.test.ts",
    "packages/execution-contract/test/work-causality.test.ts",
    "packages/execution-contract/test/resource-accounting.test.ts",
    "packages/execution-contract/test/stage-timing.test.ts",
    "packages/execution-contract/test/effect-safety.test.ts",
    "packages/adapter-contract/test/adapter-contract.test.ts",
    "packages/execution-observability/test/work-execution-report.test.ts",
  ]),
  replay: Object.freeze([
    "packages/event-store-sqlite/test/event-store.test.ts",
    "packages/event-store-sqlite/test/row-codec.test.ts",
    "packages/project/test/event-writer-activation.test.ts",
    "packages/sync-contract/test/event-batch.test.ts",
    "packages/sync-contract/test/receiver-state.test.ts",
    "packages/hub-sync-sqlite/test/trace-integration.test.ts",
    "apps/hub/test/sync-http.test.ts",
  ]),
  journeys: Object.freeze([
    "apps/cli/test/managed-run.test.ts",
    "apps/node-runtime/test/managed-provider-runtime.test.ts",
    "apps/cli/test/event-reader-inventory.test.ts",
  ]),
});

export const foundationReadinessChecks = Object.freeze([
  { checkId: "contracts", command: "pnpm", args: ["foundation:contracts:check"] },
  { checkId: "replay", command: "pnpm", args: ["foundation:replay:check"] },
  { checkId: "performance", command: "pnpm", args: ["foundation:performance:check"] },
  { checkId: "recovery", command: "pnpm", args: ["foundation:recovery:check"] },
  { checkId: "security", command: "pnpm", args: ["foundation:security:check"] },
  { checkId: "capacity", command: "pnpm", args: ["foundation:capacity:check"] },
  { checkId: "managed_journeys", command: "pnpm", args: ["foundation:journeys:check"] },
  { checkId: "fresh_clone", command: "pnpm", args: ["foundation:fresh-clone:check"] },
  { checkId: "distribution", command: "pnpm", args: ["foundation:distribution:check"] },
  { checkId: "drift", command: "pnpm", args: ["foundation:drift:check"] },
]);

export async function hashFoundationReadinessSuites(repositoryRoot) {
  const paths = [
    ...new Set([
      ...Object.values(foundationFocusedSuites).flat(),
      "package.json",
      "scripts/check-built-cli.mjs",
      "scripts/check-packed-cli.mjs",
      "scripts/check-hub-runtime-distribution.mjs",
      "scripts/check-node-runtime-distribution.mjs",
      "scripts/check-natural-language-evaluation.mjs",
    ]),
  ].sort();
  return Promise.all(
    paths.map(async (path) => ({
      path,
      contentHash: `sha256:${createHash("sha256")
        .update(await readFile(resolve(repositoryRoot, path)))
        .digest("hex")}`,
    })),
  );
}

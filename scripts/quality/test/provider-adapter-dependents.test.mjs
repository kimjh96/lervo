import assert from "node:assert/strict";

import { it } from "vitest";

import { providerAdapterDependencyViolations } from "../lib/provider-adapter-dependents.mjs";

const manifests = (entries) => new Map(Object.entries(entries));

it("lets applications and the knowledge runtime compose provider adapters", () => {
  assert.deepEqual(
    providerAdapterDependencyViolations(
      manifests({
        "@lervo/cli": { layer: "app", dependencies: ["@lervo/adapter-claude"] },
        "@lervo/repository-knowledge-runtime": {
          layer: "package",
          dependencies: ["@lervo/adapter-claude", "@lervo/adapter-codex"],
        },
        "@lervo/adapter-claude": { layer: "package", dependencies: ["@lervo/adapter-contract"] },
        "@lervo/repository-knowledge-compiler": {
          layer: "package",
          dependencies: ["@lervo/adapter-contract"],
        },
      }),
    ),
    [],
  );
});

it("refuses a provider adapter as another package's production dependency", () => {
  const failures = providerAdapterDependencyViolations(
    manifests({
      "@lervo/repository-knowledge-compiler": {
        layer: "package",
        dependencies: ["@lervo/adapter-contract", "@lervo/adapter-codex"],
      },
    }),
  );
  assert.equal(failures.length, 1);
  assert.match(
    failures[0],
    /repository-knowledge-compiler must not depend on provider adapter @lervo\/adapter-codex/u,
  );
});

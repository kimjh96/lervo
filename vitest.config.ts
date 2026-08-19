import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@lervo/adapter-contract": fromRoot("./packages/adapter-contract/src/index.ts"),
      "@lervo/adapter-claude": fromRoot("./packages/adapter-claude/src/index.ts"),
      "@lervo/adapter-codex": fromRoot("./packages/adapter-codex/src/index.ts"),
      "@lervo/cas": fromRoot("./packages/cas/src/index.ts"),
      "@lervo/context": fromRoot("./packages/context/src/index.ts"),
      "@lervo/context-delivery": fromRoot("./packages/context-delivery/src/index.ts"),
      "@lervo/deliberation": fromRoot("./packages/deliberation/src/index.ts"),
      "@lervo/deliberation-runtime": fromRoot("./packages/deliberation-runtime/src/index.ts"),
      "@lervo/diagnostics": fromRoot("./packages/diagnostics/src/index.ts"),
      "@lervo/core": fromRoot("./packages/core/src/index.ts"),
      "@lervo/documents": fromRoot("./packages/documents/src/index.ts"),
      "@lervo/event-contract": fromRoot("./packages/event-contract/src/index.ts"),
      "@lervo/event-store-sqlite": fromRoot("./packages/event-store-sqlite/src/index.ts"),
      "@lervo/hub": fromRoot("./apps/hub/src/index.ts"),
      "@lervo/hub-sync": fromRoot("./packages/hub-sync/src/index.ts"),
      "@lervo/hub-sync-sqlite": fromRoot("./packages/hub-sync-sqlite/src/index.ts"),
      "@lervo/hub-trace": fromRoot("./packages/hub-trace/src/index.ts"),
      "@lervo/knowledge": fromRoot("./packages/knowledge/src/index.ts"),
      "@lervo/orchestrator": fromRoot("./packages/orchestrator/src/index.ts"),
      "@lervo/project": fromRoot("./packages/project/src/index.ts"),
      "@lervo/project-storage": fromRoot("./packages/project-storage/src/index.ts"),
      "@lervo/remote-command": fromRoot("./packages/remote-command/src/index.ts"),
      "@lervo/remote-command-contract": fromRoot("./packages/remote-command-contract/src/index.ts"),
      "@lervo/remote-command-sqlite": fromRoot("./packages/remote-command-sqlite/src/index.ts"),
      "@lervo/schemas": fromRoot("./packages/schemas/src/index.ts"),
      "@lervo/skills": fromRoot("./packages/skills/src/index.ts"),
      "@lervo/storage-contract": fromRoot("./packages/storage-contract/src/index.ts"),
      "@lervo/sync": fromRoot("./packages/sync/src/index.ts"),
      "@lervo/sync-contract": fromRoot("./packages/sync-contract/src/index.ts"),
      "@lervo/verification": fromRoot("./packages/verification/src/index.ts"),
      "@lervo/verification-contract": fromRoot("./packages/verification-contract/src/index.ts"),
      "@lervo/writing": fromRoot("./packages/writing/src/index.ts"),
      "@lervo/writing-contract": fromRoot("./packages/writing-contract/src/index.ts"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});

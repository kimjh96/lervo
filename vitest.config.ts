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
      "@lervo/core": fromRoot("./packages/core/src/index.ts"),
      "@lervo/documents": fromRoot("./packages/documents/src/index.ts"),
      "@lervo/event-contract": fromRoot("./packages/event-contract/src/index.ts"),
      "@lervo/event-store-sqlite": fromRoot("./packages/event-store-sqlite/src/index.ts"),
      "@lervo/orchestrator": fromRoot("./packages/orchestrator/src/index.ts"),
      "@lervo/project": fromRoot("./packages/project/src/index.ts"),
      "@lervo/project-storage": fromRoot("./packages/project-storage/src/index.ts"),
      "@lervo/schemas": fromRoot("./packages/schemas/src/index.ts"),
      "@lervo/skills": fromRoot("./packages/skills/src/index.ts"),
      "@lervo/storage-contract": fromRoot("./packages/storage-contract/src/index.ts"),
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

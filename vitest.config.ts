import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@roven/adapter-contract": fromRoot("./packages/adapter-contract/src/index.ts"),
      "@roven/adapter-claude": fromRoot("./packages/adapter-claude/src/index.ts"),
      "@roven/adapter-codex": fromRoot("./packages/adapter-codex/src/index.ts"),
      "@roven/cas": fromRoot("./packages/cas/src/index.ts"),
      "@roven/context": fromRoot("./packages/context/src/index.ts"),
      "@roven/core": fromRoot("./packages/core/src/index.ts"),
      "@roven/documents": fromRoot("./packages/documents/src/index.ts"),
      "@roven/event-contract": fromRoot("./packages/event-contract/src/index.ts"),
      "@roven/event-store-sqlite": fromRoot("./packages/event-store-sqlite/src/index.ts"),
      "@roven/orchestrator": fromRoot("./packages/orchestrator/src/index.ts"),
      "@roven/project": fromRoot("./packages/project/src/index.ts"),
      "@roven/project-storage": fromRoot("./packages/project-storage/src/index.ts"),
      "@roven/schemas": fromRoot("./packages/schemas/src/index.ts"),
      "@roven/skills": fromRoot("./packages/skills/src/index.ts"),
      "@roven/storage-contract": fromRoot("./packages/storage-contract/src/index.ts"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});

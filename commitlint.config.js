import { workspaceCommitScopes } from "./scripts/lib/workspace-commit-scopes.mjs";

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    "scope-case": [2, "always", "kebab-case"],
    "scope-enum": [2, "always", workspaceCommitScopes()],
  },
};

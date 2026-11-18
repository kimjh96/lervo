import { execFileSync } from "node:child_process";

const fixtureAuthor = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.invalid",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.invalid",
};

/**
 * ADR-0561: a reviewed effect applies only as its own undo commit, over committed user paths.
 * Fixtures commit the user files they wrote before planning one, because the Git HEAD is a
 * knowledge source and a commit between the plan and its apply would change the plan. Lervo's own
 * state and outputs stay uncommitted, as the effect guard ignores them. Initializes Git when
 * needed; returns whether anything was committed.
 */
export function commitRepository(root: string, message = "chore: fixture"): boolean {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      env: { ...process.env, ...fixtureAuthor },
      stdio: "pipe",
    });
  try {
    git(["rev-parse", "--show-toplevel"]);
  } catch {
    git(["init", "-q", "-b", "main"]);
  }
  git(["add", "-A", "--", ".", ":(exclude).lervo", ":(exclude)docs/knowledge"]);
  try {
    git(["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    git(["commit", "-q", "--no-verify", "-m", message]);
    return true;
  }
}

import { execFileSync } from "node:child_process";

const fixtureAuthor = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.invalid",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.invalid",
};

/**
 * ADR-0561: a reviewed effect applies only as its own undo commit, over committed user paths.
 * Fixtures that apply one first commit everything they wrote, initializing Git when needed.
 */
export function commitRepository(root: string, message = "chore: fixture"): void {
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
  git(["add", "-A"]);
  git(["commit", "-q", "--allow-empty", "--no-verify", "-m", message]);
}

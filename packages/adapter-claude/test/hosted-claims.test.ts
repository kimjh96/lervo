import { describe, expect, it } from "vitest";

import { claudeClaimAnswer, claudeWriteIntent } from "../src/index.js";

const cwd = "/work/repo";
function bash(command: string) {
  const intent = claudeWriteIntent("Bash", { command }, cwd);
  if (intent === null) throw new Error("A shell call always has an intent.");
  return intent;
}

describe("what a Claude Code tool call writes", () => {
  it("reads a file tool's own path, never its content", () => {
    expect(claudeWriteIntent("Edit", { file_path: "src/a.ts", new_string: "x" }, cwd)).toEqual({
      toolClass: "file",
      targets: [{ path: "/work/repo/src/a.ts", kind: "file" }],
      detection: "exact",
    });
    expect(
      claudeWriteIntent("NotebookEdit", { notebook_path: "/work/repo/n.ipynb" }, cwd),
    ).toMatchObject({
      toolClass: "notebook",
      targets: [{ path: "/work/repo/n.ipynb", kind: "file" }],
    });
    expect(claudeWriteIntent("Read", { file_path: "src/a.ts" }, cwd)).toBeNull();
  });

  it("reads the shell forms that plainly write", () => {
    expect(bash("echo hi > out.txt && tee -a log.txt < x").targets).toEqual([
      { path: "/work/repo/out.txt", kind: "file" },
      { path: "/work/repo/log.txt", kind: "file" },
    ]);
    expect(bash("rm -rf build; mkdir -p dist/a; touch b.txt").targets).toEqual([
      { path: "/work/repo/build", kind: "directory" },
      { path: "/work/repo/dist/a", kind: "directory" },
      { path: "/work/repo/b.txt", kind: "file" },
    ]);
    expect(bash("mv a.ts b.ts | cat; cp x.ts y.ts z/").targets).toEqual([
      { path: "/work/repo/a.ts", kind: "file" },
      { path: "/work/repo/b.ts", kind: "file" },
      { path: "/work/repo/z", kind: "file" },
    ]);
    expect(bash("sed -i 's/$/;/' 'src/my file.ts'").targets).toEqual([
      { path: "/work/repo/src/my file.ts", kind: "file" },
    ]);
    expect(bash("git mv old.ts new.ts && git rm gone.ts").targets).toHaveLength(3);
  });

  it("claims a redirection's file, never a descriptor it duplicates or closes", () => {
    const claimed = (command: string) => bash(command).targets.map((target) => target.path);
    expect(claimed("pnpm test 2>&1 | tail")).toEqual([]);
    expect(claimed("echo hi >&2")).toEqual([]);
    expect(claimed("exec 3>&-; echo hi 1>&2")).toEqual([]);
    expect(claimed("git log 2>/dev/null")).toEqual([]);
    expect(claimed("pnpm build &>build.log")).toEqual(["/work/repo/build.log"]);
    expect(claimed("pnpm build &>> build.log")).toEqual(["/work/repo/build.log"]);
    expect(claimed("echo a 1>out.txt")).toEqual(["/work/repo/out.txt"]);
    expect(claimed("echo a 2>> err.log")).toEqual(["/work/repo/err.log"]);
    expect(claimed("echo a >|forced.txt")).toEqual(["/work/repo/forced.txt"]);
    expect(claimed("echo a >&both.txt")).toEqual(["/work/repo/both.txt"]);
    expect(bash("pnpm test 2>&1 | tail").detection).toBe("parsed");
  });

  it("follows a leading cd, claims a glob's directory, and skips /dev", () => {
    expect(bash("cd packages/a && rm src/*.ts 2>/dev/null").targets).toEqual([
      { path: "/work/repo/packages/a/src", kind: "directory" },
    ]);
  });

  it("leaves what it cannot resolve to the turn's end, and claims nothing for reads", () => {
    expect(bash('rm "$TARGET"')).toEqual({
      toolClass: "shell",
      targets: [],
      detection: "undetected",
    });
    expect(bash("touch ~/notes.txt").detection).toBe("undetected");
    expect(bash("git status && ls -la && git checkout -- src/a.ts")).toEqual({
      toolClass: "shell",
      targets: [],
      detection: "parsed",
    });
  });
});

describe("the pre-tool hook's answer", () => {
  it("speaks only to refuse, so the owner's permission settings still decide the rest", () => {
    expect(claudeClaimAnswer({ decision: "allow" })).toBe("{}\n");
    expect(claudeClaimAnswer({ decision: "defer" })).toBe("{}\n");
    expect(
      JSON.parse(claudeClaimAnswer({ decision: "deny", reason: "Ciel holds src/a.ts." })),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Ciel holds src/a.ts.",
      },
    });
  });
});

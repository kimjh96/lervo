// The claim handler in a conversation's worktree (Lervo ADE coordination, "Where the handler
// runs"). With coordination active, `lervo workspace start` writes the provider's pre-tool hook
// into the worktree's local settings, so every session there claims its writes, hosted or the
// owner's own terminal. The repository's info/exclude gains a Lervo-managed block for that file,
// so it never shows as a change. Lervo writes only its own handler group and its own block.
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { replaceFile } from "@lervo/filesystem-durability";
import {
  type ClaimHandlerBlocker,
  mergeClaimHandler,
  PROVIDERS,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { terminalHookCommandOf } from "./hosted-terminal-hooks.js";
import { claimReading } from "./write-claims.js";

const run = promisify(execFile);

/**
 * How long the provider waits for a claim. A served claim answers within `CLAIM_DECISION_MS`; one
 * its server lost after 25 seconds decides again in process within that bound. Both fit, so the
 * provider never lets a write go ahead because the hook ran out of time.
 */
export const CLAIM_HOOK_TIMEOUT_SECONDS = 60;
/** Each provider's settings file that is local to one checkout. */
const LOCAL_SETTINGS: Readonly<Partial<Record<TerminalIntegrationProvider, string>>> = {
  claude: ".claude/settings.local.json",
};
/** A settings or exclude file larger than this is not one Lervo edits. */
const MAXIMUM_BYTES = 1024 * 1024;
const EXCLUDE_BEGIN = "# lervo:begin claim-handler schema=1";
const EXCLUDE_END = "# lervo:end claim-handler";

/**
 * Why the start left the worktree without the handler. A hosted session then carries its own, and
 * the turn's end claims what a session without one changed.
 */
export type ClaimHandlerSkip =
  | ClaimHandlerBlocker
  | "provider_claims_nothing"
  | "settings_tracked"
  | "settings_unsafe"
  | "exclude_unsafe"
  | "write_failed";

export type ClaimHandlerWrite =
  | { readonly status: "written" | "unchanged" }
  | { readonly status: "skipped"; readonly code: ClaimHandlerSkip };

class Skip extends Error {
  constructor(readonly code: ClaimHandlerSkip) {
    super(code);
  }
}

/** The file's text, null when it does not exist, or a skip when it is no plain file Lervo edits. */
async function plainText(path: string, unsafe: ClaimHandlerSkip): Promise<string | null> {
  let found;
  try {
    found = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!found.isFile() || found.size > MAXIMUM_BYTES) throw new Skip(unsafe);
  return readFile(path, "utf8");
}

async function git(worktree: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", worktree, ...arguments_], {
    encoding: "utf8",
    maxBuffer: MAXIMUM_BYTES,
    windowsHide: true,
  });
  return stdout.trim();
}

/** `exclude` with Lervo's block naming `rule`, replacing an earlier block. */
export function withExcludeBlock(exclude: string | null, rule: string): string {
  const content = exclude ?? "";
  const begin = content.indexOf(EXCLUDE_BEGIN);
  const end = content.indexOf(EXCLUDE_END, begin);
  const block = `${EXCLUDE_BEGIN}\n${rule}\n${EXCLUDE_END}\n`;
  if (begin === -1 || end === -1)
    return `${content}${content === "" || content.endsWith("\n") ? "" : "\n"}${block}`;
  return `${content.slice(0, begin)}${block}${content.slice(end + EXCLUDE_END.length).replace(/^\n/u, "")}`;
}

async function writeExclude(worktree: string, rule: string): Promise<void> {
  const common = resolve(
    worktree,
    await git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"),
  );
  const path = resolve(common, "info", "exclude");
  const before = await plainText(path, "exclude_unsafe");
  const after = withExcludeBlock(before, rule);
  if (after === before) return;
  await mkdir(dirname(path), { recursive: true });
  await replaceFile(path, after, { mode: 0o644 });
}

/**
 * Writes `provider`'s claim handler into the worktree's local settings and the exclude block for
 * them. It never throws: a worktree left without the handler reports why.
 */
export async function writeClaimHandler(
  worktree: string,
  provider: string,
  options: { launcher?: string; platform?: NodeJS.Platform } = {},
): Promise<ClaimHandlerWrite> {
  const known = (PROVIDERS as readonly string[]).includes(provider)
    ? (provider as TerminalIntegrationProvider)
    : null;
  const local = known === null ? undefined : LOCAL_SETTINGS[known];
  const claims = claimReading(provider);
  if (known === null || local === undefined || claims === null)
    return { status: "skipped", code: "provider_claims_nothing" };
  try {
    if ((await git(worktree, "ls-files", "--", local)) !== "") throw new Skip("settings_tracked");
    const path = resolve(worktree, local);
    const before = await plainText(path, "settings_unsafe");
    const { command } = await terminalHookCommandOf(known, options);
    const merged = mergeClaimHandler(before, {
      command: `${command} --claim`,
      matcher: claims.claimTools,
      timeoutSeconds: CLAIM_HOOK_TIMEOUT_SECONDS,
    });
    if ("blocker" in merged) throw new Skip(merged.blocker);
    // The exclude block comes first, so the file never shows as a change, even for a moment.
    await writeExclude(worktree, `/${local}`);
    if (!merged.changed) return { status: "unchanged" };
    await mkdir(dirname(path), { recursive: true });
    const mode = before === null ? 0o644 : (await lstat(path)).mode & 0o777;
    await replaceFile(path, merged.content, { mode });
    return { status: "written" };
  } catch (error) {
    return { status: "skipped", code: error instanceof Skip ? error.code : "write_failed" };
  }
}

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { runDocumentFreshnessCycle } from "../src/freshness-stage.js";
import { fixture } from "./fixture.js";
import { isolateProviderCliDetection } from "./provider-cli-detection-isolation.js";

const execute = promisify(execFile);
const fixtureProvider = resolve(
  import.meta.dirname,
  "../../../scripts/distribution/fixtures/document-freshness-claude.mjs",
);

export interface FreshnessPlanHunk {
  before: string;
  after: string;
  evidencePaths: string[];
}

export interface FreshnessPlanEntry {
  operation: "edit" | "archive" | "no_change_needed" | "needs_owner_input";
  hunks?: FreshnessPlanHunk[];
  archiveName?: string;
  currentDocumentPath?: string;
  explanation?: string;
  assessmentAgrees?: boolean;
  /** The nth no-change review for the document answers with the nth mode; then `assessmentAgrees`. */
  assessmentSequence?: Array<"agree" | "disagree" | "invalid">;
  /** `omit` reports no usage for the no-change review. */
  assessmentUsage?: "omit";
  /** Input tokens the no-change review reports; `inputTokens` when absent. */
  assessmentInputTokens?: number;
  /** Tier 0 reviewer answer; `agree` when absent. */
  crossCheck?: "agree" | "disagree" | "invalid" | "fail" | "quota";
  /** The nth cross-check call for the document answers with the nth mode; then `crossCheck`. */
  crossCheckSequence?: Array<"agree" | "disagree" | "invalid" | "fail" | "quota">;
  /** With `disagree`, contest only the hunks with these `before` texts. */
  crossCheckDisagree?: string[];
  crossCheckInputTokens?: number;
}

/**
 * A scratch repository with an active convergence delegation and the document freshness fixture
 * provider, which answers from a per-document plan instead of a model.
 */
export async function freshnessFixture(eventSchema: 4 | 5 = 4) {
  const base = await fixture(true, false, false, 0, eventSchema);
  // A provider failure must defer the cycle, not fall back to a provider CLI on the host.
  isolateProviderCliDetection(base.directory);
  const providerDirectory = resolve(base.directory, "freshness-provider");
  await mkdir(providerDirectory, { recursive: true });
  const executable = resolve(providerDirectory, "claude");
  await copyFile(fixtureProvider, executable);
  await execute("chmod", ["0700", executable]);
  const root = base.root;
  const git = async (args: string[], env: NodeJS.ProcessEnv = {}) =>
    (
      await execute(
        "git",
        ["-C", root, "-c", "user.name=Owner", "-c", "user.email=owner@lervo.invalid", ...args],
        {
          env: { ...process.env, ...env },
        },
      )
    ).stdout;
  return {
    ...base,
    executable,
    async write(path: string, content: string) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await writeFile(resolve(root, path), content);
    },
    async remove(path: string) {
      await rm(resolve(root, path), { recursive: true, force: true });
    },
    read: (path: string) => readFile(resolve(root, path), "utf8"),
    async commit(message: string, date?: string) {
      await git(["add", "-A"]);
      await git(
        ["commit", "--quiet", "-m", message],
        date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      );
      return (await git(["rev-parse", "HEAD"])).trim();
    },
    git,
    async plan(entries: Record<string, FreshnessPlanEntry>) {
      await writeFile(
        resolve(providerDirectory, "document-freshness-plan.json"),
        JSON.stringify(entries),
      );
    },
    async providerCalls(): Promise<
      Array<{
        task: string;
        document: string | null;
        regeneration?: string | null;
        offersIdentifiers?: boolean;
      }>
    > {
      try {
        return (
          await readFile(resolve(providerDirectory, "document-freshness-calls.jsonl"), "utf8")
        )
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                task: string;
                document: string | null;
                regeneration?: string | null;
                offersIdentifiers?: boolean;
              },
          );
      } catch {
        return [];
      }
    },
    cycle(now = new Date()) {
      return runDocumentFreshnessCycle({
        context: {
          storage: base.storage,
          provider: "claude",
          executable,
          admissionDirectory: base.admissionDirectory,
          signal: new AbortController().signal,
          liveWorkPending: async () => false,
          now: () => now,
        },
      });
    },
    eventsOf(type: string) {
      return base.events.list({ limit: 1_000 }).filter((event) => event.type === type);
    },
  };
}

export type FreshnessFixture = Awaited<ReturnType<typeof freshnessFixture>>;

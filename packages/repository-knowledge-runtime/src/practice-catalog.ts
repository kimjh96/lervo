import { listAgents } from "@lervo/agent-workforce";
import {
  canonicalJson,
  inspectDurableInstructionCatalog,
  practicePublicPath,
  sanitizePracticeText,
  scanConfiguredRepositoryKnowledge,
  sha256,
} from "@lervo/repository-knowledge";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { ConvergenceDelegation } from "./delegation.js";
import type { PracticeState } from "./practice-state.js";

export interface PracticeCatalog {
  digest: string;
  complete: boolean;
  readRoots: string[];
  readablePaths: string[];
  skills: Array<{
    name: string;
    path: string;
    contentHash: string;
    content: string;
    owned: boolean;
  }>;
  rules: Array<{ path: string; contentHash: string; excerpt: string }>;
}

/** Provider context excludes the scanner inventory and the host's read-scope coordinates. */
export function disclosePracticeCatalog(catalog: PracticeCatalog) {
  return {
    digest: catalog.digest,
    complete: catalog.complete,
    skills: catalog.skills,
    rules: catalog.rules,
  };
}

export async function loadPracticeCatalog(
  root: string,
  delegation: ConvergenceDelegation,
  state: PracticeState,
): Promise<PracticeCatalog> {
  const parent = (await listAgents(root, { readOnly: true })).find(
    (a) => a.agentId === delegation.parentAgentId,
  );
  const readRoots = parent?.responsibilityPaths ?? [];
  const prepared = await scanConfiguredRepositoryKnowledge(root);
  const scan = prepared.scan;
  const rules = inspectDurableInstructionCatalog(prepared).semanticCatalog.canonicalInstructions;
  let remaining = 32 * 1024;
  let complete = rules.complete;
  const skills: PracticeCatalog["skills"] = [];
  for (const source of scan.sources.filter((s) =>
    /^(?:\.agents|\.claude|\.codex)\/skills\/[^/]+\/SKILL\.md$/u.test(s.path),
  )) {
    if (
      source.status !== "included" ||
      !source.content ||
      !source.contentHash ||
      !practicePublicPath(source.path) ||
      !readRoots.some((r) => repositoryPathWithinScope(source.path, r))
    ) {
      complete = false;
      continue;
    }
    const content = sanitizePracticeText(source.content);
    if (Buffer.byteLength(content) > Math.min(8192, remaining) || skills.length >= 64) {
      complete = false;
      continue;
    }
    remaining -= Buffer.byteLength(content);
    skills.push({
      name: source.path.split("/")[2]!,
      path: source.path,
      contentHash: source.contentHash,
      content,
      owned: state.generated.some(
        (s) => s.path === source.path && s.versionHash === source.contentHash,
      ),
    });
  }
  const publicRules = rules.entries
    .filter(
      (r) =>
        practicePublicPath(r.path) && readRoots.some((p) => repositoryPathWithinScope(r.path, p)),
    )
    .map((r) => ({
      path: r.path,
      contentHash: r.contentHash,
      excerpt: sanitizePracticeText(r.excerpt),
    }));
  if (publicRules.length !== rules.entries.length) complete = false;
  return {
    digest: sha256(
      canonicalJson([
        skills.map(({ path, contentHash }) => ({ path, contentHash })),
        publicRules.map(({ path, contentHash }) => ({ path, contentHash })),
      ]),
    ),
    complete,
    readRoots,
    readablePaths: scan.sources
      .filter((s) => s.status === "included" && practicePublicPath(s.path))
      .map((s) => s.path),
    skills,
    rules: publicRules,
  };
}

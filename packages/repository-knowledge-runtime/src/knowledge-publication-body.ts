import type { KnowledgePublicationCommit } from "./knowledge-publication-git.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

export const KNOWLEDGE_PUBLICATION_TITLE = "docs: publish reviewed background knowledge";

const MAXIMUM_LISTED_PATHS = 40;
const OBLIGATION = /Lervo convergence (\S+) settled/u;
const FRESHNESS = /^Lervo-Freshness-(?:Candidate|Revert): (\S+)$/mu;

function origin(commit: KnowledgePublicationCommit): string {
  const obligation = OBLIGATION.exec(commit.body)?.[1];
  if (obligation !== undefined) return `convergence obligation \`${obligation}\``;
  const freshness = FRESHNESS.exec(commit.body)?.[1];
  return freshness === undefined
    ? "no recorded obligation"
    : `freshness candidate \`${freshness}\``;
}

/**
 * The pull request body for one publication. It follows `.github/PULL_REQUEST_TEMPLATE.md`
 * section by section, starts at H2, and checks only the items the publisher itself verified.
 */
export function renderKnowledgePublicationBody(input: {
  commits: readonly KnowledgePublicationCommit[];
  settings: KnowledgePublicationSettings;
  host: { hostHash: string; hostLabel: string };
  rebuilt: boolean;
}): string {
  const { commits, settings, host } = input;
  const paths = [...new Set(commits.flatMap((commit) => commit.paths))].sort();
  const listed = paths.slice(0, MAXIMUM_LISTED_PATHS);
  const roots = settings.allowedRoots.map((root) => `\`${root}\``).join(" and ");
  const merge =
    settings.merge === "when_checks_pass"
      ? "The publisher merges this pull request with a merge commit after every reported check succeeds, and only while its head is still the commit it pushed."
      : "The publisher does not merge. A person reviews and merges this pull request.";
  return [
    "## Summary",
    "",
    `This pull request publishes ${commits.length} reviewed background knowledge commit${commits.length === 1 ? "" : "s"} from the Lervo convergence owner \`${host.hostLabel}\` (host \`${host.hostHash.slice(7, 19)}\`). Reviewed convergence settled these outputs, and the \`Lervo Knowledge\` identity committed them. Publishing them keeps every checkout on one history instead of leaving them on one host's local \`${settings.baseBranch}\`.`,
    "",
    "## Scope and authority",
    "",
    `In scope: ${paths.length} file${paths.length === 1 ? "" : "s"} under ${roots}.`,
    "",
    ...listed.map((path) => `- \`${path}\``),
    ...(paths.length > listed.length ? [`- ${paths.length - listed.length} more files`] : []),
    "",
    `Out of scope: developer work. The publisher includes only non-merge commits whose author and committer are both \`Lervo Knowledge\`, and it refuses the whole publication if any of them changes a path outside ${roots}.${input.rebuilt ? ` Other local commits exist, so these commits were replayed onto \`${settings.remote}/${settings.baseBranch}\` without them.` : ""}`,
    "",
    `Authority: this host's reviewed convergence delegation and its live convergence owner lease (ADR-0466). External writes: a lease-protected push to \`${settings.branch}\` and this pull request. ${merge}`,
    "",
    "## Contract and architecture",
    "",
    "N/A: this pull request changes only reviewed documentation outputs and their normalization records. No source module, package boundary, or contract changes.",
    "",
    "## Release impact",
    "",
    "N/A: documentation and Lervo knowledge records are exempt under ADR-0221. No CLI or bundled-private implementation changed.",
    "",
    "## Verification",
    "",
    "- Run by the publisher before the push: the identity and path scope check described above. It passed for every commit.",
    "- Repository CI on this pull request runs the configured workflows. The publisher reports no CI result here and merges only after every check succeeds.",
    "- Not run by the publisher: local tests, `pnpm quality:check`, and `pnpm docs:check`.",
    "",
    "## Knowledge and documentation",
    "",
    "Each commit and the reviewed work it settles:",
    "",
    ...commits.map(
      (commit) => `- \`${commit.sha.slice(0, 12)}\` ${commit.subject}: ${origin(commit)}`,
    ),
    "",
    "These files are the canonical documentation outputs themselves. No roadmap criterion changes through this publication.",
    "",
    "## Risk and recovery",
    "",
    "If a check fails or the push is refused, the publisher leaves this pull request open, stops merging, and records one `knowledge_publication` attention item on the owner host. To undo a merged output, revert its merge commit. The next convergence cycle then reviews the affected documents again.",
    "",
    "## Checklist",
    "",
    "Unchecked items are not verified by the publisher. Items 1 and 2: an automated publisher reads no instructions and touches no source; the reviewed convergence stages did their own reading, and their receipts stay in the owner's event store. Items 5 to 7: CI on this pull request is the evidence, and the publisher does not claim it in advance. Items 3 and 4 rest on the scope check: only documents and their one-per-document normalization records change, and all of them are Lervo-managed reviewed outputs.",
    "",
    "- [ ] I read `AGENTS.md` and the relevant linked entrypoints before changing bytes.",
    "- [ ] I reviewed every touched source against `docs/foundation/code-convention.md`.",
    "- [x] Repository-authored state is bounded; this change adds neither an append-only file nor a one-file-per-operation archive.",
    "- [x] Lervo-managed, generated, and user-owned bytes retain distinct owners.",
    "- [ ] Affected documentation and roadmap completion criteria are current.",
    "- [ ] Relevant tests, `pnpm quality:check`, and required Lervo migration/lint checks pass.",
    "- [ ] No secret, mutable credential, or unsupported authority is included.",
    "",
  ].join("\n");
}

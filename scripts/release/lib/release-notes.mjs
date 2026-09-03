import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const currentReleaseNotesPath = ".changes/current-release.md";

const releaseMarker =
  /^<!-- lervo-release package="(@lervo\/cli)" version="(\d+\.\d+\.\d+)" schema="1" -->$/u;

export class ReleaseNotesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseNotesError";
    this.code = code;
  }
}

export function renderCurrentReleaseNotes(version, intents) {
  const summaries = intents
    .toSorted(
      (left, right) =>
        left.summary.localeCompare(right.summary) || left.intentId.localeCompare(right.intentId),
    )
    .map((intent) => `- ${intent.summary}`);
  return [
    `<!-- lervo-release package="@lervo/cli" version="${version}" schema="1" -->`,
    "",
    "## What's changed",
    "",
    ...summaries,
    "",
  ].join("\n");
}

export function parseCurrentReleaseNotes(content) {
  const [firstLine] = content.split("\n", 1);
  const marker = releaseMarker.exec(firstLine);
  if (marker === null || !content.endsWith("\n"))
    throw new ReleaseNotesError(
      "release_notes_invalid",
      "Current release notes do not satisfy the versioned release-note contract.",
    );
  if (!content.includes("\n\n## What's changed\n\n- "))
    throw new ReleaseNotesError(
      "release_notes_empty",
      "Current release notes require at least one user-facing change.",
    );
  return { package: marker[1], version: marker[2] };
}

export async function readCurrentReleaseNotes(repositoryRoot) {
  const content = await readFile(resolve(repositoryRoot, currentReleaseNotesPath), "utf8");
  return { content, ...parseCurrentReleaseNotes(content) };
}

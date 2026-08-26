import { describe, expect, it } from "vitest";

import {
  parseCurrentReleaseNotes,
  ReleaseNotesError,
  renderCurrentReleaseNotes,
} from "../lib/release-notes.mjs";

describe("current CLI release notes", () => {
  it("renders sorted deterministic notes with hidden exact coordinates", () => {
    const notes = renderCurrentReleaseNotes("0.3.0", [
      { intentId: "relint_b", summary: "Improve Windows deployment." },
      { intentId: "relint_a", summary: "Add bounded release notes." },
    ]);
    expect(notes).toBe(
      '<!-- lervo-release package="@lervo/cli" version="0.3.0" schema="1" -->\n\n## What\'s changed\n\n- Add bounded release notes.\n- Improve Windows deployment.\n',
    );
    expect(parseCurrentReleaseNotes(notes)).toEqual({ package: "@lervo/cli", version: "0.3.0" });
  });

  it("rejects unversioned or empty notes", () => {
    expect(() => parseCurrentReleaseNotes("## What's changed\n\n- Missing marker.\n")).toThrow(
      ReleaseNotesError,
    );
    expect(() =>
      parseCurrentReleaseNotes(
        '<!-- lervo-release package="@lervo/cli" version="0.3.0" schema="1" -->\n',
      ),
    ).toThrowError(expect.objectContaining({ code: "release_notes_empty" }));
  });
});

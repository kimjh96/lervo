import { describe, expect, it, vi } from "vitest";

import * as gitModule from "../src/knowledge-publication-git.js";
import { builtAfterMerges } from "../src/knowledge-publication-pull-patches.js";
import { commit, git, knowledge, setup } from "./knowledge-publication-fixture.js";

vi.mock("../src/knowledge-publication-git.js", { spy: true });

/** ADR-0607: the clock-free ancestry rule asks git once per merge commit, parent and pair. */
describe("built after a merge", () => {
  it("asks git once for each merge commit, parent and pair", { timeout: 60_000 }, async () => {
    const { root } = await setup();
    await commit(root, "docs/a.md", "# A\n", knowledge);
    const merge = await git(root, ["rev-parse", "HEAD"]);
    await commit(root, "docs/b.md", "# B\n", knowledge);
    const after = await git(root, ["rev-parse", "HEAD"]);
    await commit(root, "docs/c.md", "# C\n", knowledge);
    const later = await git(root, ["rev-parse", "HEAD"]);
    const missing = "f".repeat(40);
    vi.mocked(gitModule.git).mockClear();
    // The same patch in many pull requests that share a merge commit, as a regenerated change is.
    const pairs = [after, later].flatMap((sha) =>
      [1, 2, 3, 4].flatMap((number) => [
        { sha, number, mergeCommit: merge },
        { sha, number, mergeCommit: missing },
        { sha, number, mergeCommit: null },
      ]),
    );
    const built = await builtAfterMerges(root, pairs);
    expect([...built].sort()).toEqual(
      [1, 2, 3, 4].flatMap((number) => [`${after}:${number}`, `${later}:${number}`]).sort(),
    );
    // Two merge commits, two parents, two pairs: six questions, not one per pull request.
    expect(vi.mocked(gitModule.git)).toHaveBeenCalledTimes(6);
  });
});

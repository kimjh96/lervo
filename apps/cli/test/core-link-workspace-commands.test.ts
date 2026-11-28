import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { commandAnswer } from "../src/core-link-commands.js";
import type { CoreLinkHandlers } from "../src/core-link-handlers.js";
import { runCoreLinkWorkspaceCommand } from "../src/core-link-workspace-commands.js";
import {
  ownerConversationTitle,
  readHostedConversationProfiles,
} from "../src/hosted-conversation-profiles.js";
import { type HostedLaunchRecord, recordHostedLaunch } from "../src/hosted-launch-records.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const first = `wsp_${"1".repeat(24)}`;
const second = `wsp_${"2".repeat(24)}`;

function record(workspaceId: string): HostedLaunchRecord {
  return {
    schemaVersion: 1,
    workspaceId,
    sessionId: `session-${workspaceId}`,
    provider: "claude",
    projectId: "prj_0123456789abcdef",
    branch: `lervo/${workspaceId}`,
    conversationMode: "native",
    argumentDigest: `sha256:${"a".repeat(64)}`,
    settingsDigest: null,
    mcpConfigDigest: null,
    preparedAt: "2026-11-28T09:00:00.000Z",
  };
}

/** A host with launch records for `workspaces`, and where the owner's choices go. */
async function host(...workspaces: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-profiles-"));
  roots.push(root);
  const paths = {
    records: resolve(root, "hosted-launches.json"),
    profiles: resolve(root, "hosted-conversations.json"),
  };
  for (const workspaceId of workspaces)
    await recordHostedLaunch(paths.records, record(workspaceId));
  return paths;
}

const failureCode = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error as { code?: string }).code,
  );

describe("renaming and pinning a conversation", () => {
  it("keeps the owner's title and pin in an owner-only file beside the launch records", async () => {
    const paths = await host(first, second);
    expect(
      await runCoreLinkWorkspaceCommand(
        "workspace.rename",
        first,
        { title: "  Release\n checklist " },
        paths,
      ),
    ).toEqual({ workspaceId: first, title: "Release checklist" });
    const pinned = (await runCoreLinkWorkspaceCommand(
      "workspace.pin",
      first,
      { pinned: true },
      paths,
    )) as { pinnedAt: string | null };
    expect(pinned.pinnedAt).toMatch(/^2\d{3}-/u);
    // Pinning again keeps the time it was pinned, so the list never reorders on a repeat.
    expect(
      await runCoreLinkWorkspaceCommand("workspace.pin", first, { pinned: true }, paths),
    ).toEqual({ workspaceId: first, pinnedAt: pinned.pinnedAt });
    expect(await readHostedConversationProfiles(paths.profiles)).toEqual(
      new Map([
        [first, { workspaceId: first, title: "Release checklist", pinnedAt: pinned.pinnedAt }],
      ]),
    );
    expect(await ownerConversationTitle(paths.profiles, first)).toBe("Release checklist");
    expect(await ownerConversationTitle(paths.profiles, second)).toBeNull();
    expect((await stat(paths.profiles)).mode & 0o777).toBe(0o600);

    // Unpinning keeps the title; a profile without either choice leaves the file.
    expect(
      await runCoreLinkWorkspaceCommand("workspace.pin", first, { pinned: false }, paths),
    ).toEqual({ workspaceId: first, pinnedAt: null });
    expect((await readHostedConversationProfiles(paths.profiles)).get(first)).toEqual({
      workspaceId: first,
      title: "Release checklist",
    });
  });

  it("refuses an unknown conversation and an empty or overlong title", async () => {
    const paths = await host(first);
    expect(
      await failureCode(
        runCoreLinkWorkspaceCommand("workspace.rename", second, { title: "Elsewhere" }, paths),
      ),
    ).toBe("workspace_not_found");
    expect(
      await failureCode(
        runCoreLinkWorkspaceCommand("workspace.rename", first, { title: " \n " }, paths),
      ),
    ).toBe("workspace_argument_invalid");
    expect(
      await failureCode(
        runCoreLinkWorkspaceCommand("workspace.rename", first, { title: "x".repeat(257) }, paths),
      ),
    ).toBe("workspace_argument_invalid");
    expect(
      await failureCode(runCoreLinkWorkspaceCommand("workspace.pin", first, { pinned: 1 }, paths)),
    ).toBe("workspace_argument_invalid");
    // Nothing was written for a refused change.
    await expect(readFile(paths.profiles, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("drops the choices of conversations the launch records no longer name", async () => {
    const paths = await host(first, second);
    await runCoreLinkWorkspaceCommand("workspace.pin", second, { pinned: true }, paths);
    // The second conversation's records age out; the next change drops its profile.
    const fresh = await host(first);
    await runCoreLinkWorkspaceCommand(
      "workspace.rename",
      first,
      { title: "Kept" },
      { records: fresh.records, profiles: paths.profiles },
    );
    expect([...(await readHostedConversationProfiles(paths.profiles)).keys()]).toEqual([first]);
  });

  it("checks the workspace ID before the handler and answers command_unsupported without one", async () => {
    const asked: string[] = [];
    const handlers = {
      runWorkspaceCommand: async (command: string, workspaceId: string) => {
        asked.push(`${command}:${workspaceId}`);
        return { workspaceId };
      },
    } as unknown as CoreLinkHandlers;
    const answer = commandAnswer(handlers, "workspace.pin", { workspaceId: first, pinned: true });
    expect(answer.kind).toBe("result");
    await answer.run();
    expect(asked).toEqual([`workspace.pin:${first}`]);
    expect(
      await failureCode(
        commandAnswer(handlers, "workspace.rename", { workspaceId: "../x", title: "a" }).run(),
      ),
    ).toBe("workspace_not_found");
    expect(
      await failureCode(
        commandAnswer({} as CoreLinkHandlers, "workspace.rename", {
          workspaceId: first,
          title: "a",
        }).run(),
      ),
    ).toBe("command_unsupported");
  });
});

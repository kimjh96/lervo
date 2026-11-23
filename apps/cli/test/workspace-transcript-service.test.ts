import type { HostedTranscriptItem } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { MAX_PAGE_TEXT_BYTES, WorkspaceTranscripts } from "../src/workspace-transcript-service.js";

const message = (text: string, at: number): HostedTranscriptItem => ({
  content: { kind: "agent_message", text },
  createdAtMs: at,
});

function source(items: readonly HostedTranscriptItem[]) {
  let opened = 0;
  const open = async () => {
    opened += 1;
    return (async function* () {
      yield* items;
    })();
  };
  return { open, opened: () => opened };
}

describe("workspace transcripts in pages", () => {
  it("reads page after page from one reader and ends with the transcript", async () => {
    const items = Array.from({ length: 5 }, (_, index) => message(`m${index}`, index));
    const fake = source(items);
    const transcripts = new WorkspaceTranscripts(fake.open);
    expect(await transcripts.read("wsp_1", 0, 2)).toEqual({
      items: items.slice(0, 2),
      complete: false,
    });
    expect(await transcripts.read("wsp_1", 2, 2)).toEqual({
      items: items.slice(2, 4),
      complete: false,
    });
    expect(await transcripts.read("wsp_1", 4, 2)).toEqual({
      items: items.slice(4),
      complete: true,
    });
    expect(fake.opened()).toBe(1);
  });

  it("starts a new reader at an offset it did not continue", async () => {
    const items = Array.from({ length: 3 }, (_, index) => message(`m${index}`, index));
    const fake = source(items);
    const transcripts = new WorkspaceTranscripts(fake.open);
    expect(await transcripts.read("wsp_1", 1, 10)).toEqual({
      items: items.slice(1),
      complete: true,
    });
    expect(await transcripts.read("wsp_1", 5, 10)).toEqual({ items: [], complete: true });
  });

  it("keeps a page within its byte bound, and reads nothing for a provider without transcripts", async () => {
    const large = "x".repeat(MAX_PAGE_TEXT_BYTES / 2 + 1);
    const fake = source([message(large, 1), message(large, 2), message("small", 3)]);
    const transcripts = new WorkspaceTranscripts(fake.open);
    expect((await transcripts.read("wsp_1", 0, 500)).items).toHaveLength(1);
    expect((await transcripts.read("wsp_1", 1, 500)).items).toHaveLength(2);
    const none = new WorkspaceTranscripts(async () => null);
    expect(await none.read("wsp_1", 0, 500)).toEqual({ items: [], complete: true });
  });
});

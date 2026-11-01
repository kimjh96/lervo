import { sha256 } from "@lervo/repository-knowledge";
import type { FileHandle } from "node:fs/promises";
import {
  openProviderTranscript,
  transcriptPrefixDigest,
  type TranscriptPosition,
} from "./terminal-transcript-position.js";
import type { QueuedTerminalSkillTurn } from "./terminal-skill-queue.js";
import { transcriptSkillIdentifiers } from "./terminal-skill-transcript-adapters.js";

export const MAXIMUM_SKILL_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const CLAUDE_FILE_HISTORY = new Set(["file-history-snapshot", "file-history-delta"]);
export type SkillTranscriptAssessment = {
  skillTelemetry: "observed" | "unavailable" | "truncated" | "unknown";
  identifiers: string[];
};
/** Reads the recorded range once in the resident, without retaining transcript or tool content. */
export async function assessTerminalSkillTranscript(
  turn: QueuedTerminalSkillTurn,
): Promise<SkillTranscriptAssessment> {
  if (turn.provider === "codex") return { skillTelemetry: "unknown", identifiers: [] };
  const range = await readVerifiedTerminalTranscript(turn);
  return range.status === "observed"
    ? {
        skillTelemetry: "observed",
        identifiers: range.entries.flatMap((entry) =>
          transcriptSkillIdentifiers(turn.provider, entry),
        ),
      }
    : { skillTelemetry: range.status, identifiers: [] };
}

/**
 * Both recorded prefixes must still match. The Stop prefix covers a turn whose transcript did not
 * exist at its prompt, where the start prefix is empty.
 */
async function prefixesIntact(
  handle: FileHandle,
  start: TranscriptPosition,
  end: TranscriptPosition,
): Promise<boolean> {
  return (
    (await transcriptPrefixDigest(handle, start.prefixBytes)) === start.prefixDigest &&
    (await transcriptPrefixDigest(handle, end.prefixBytes)) === end.prefixDigest
  );
}

/** Shared authenticity boundary; transcript contents stay on the observing host. */
export async function readVerifiedTerminalTranscript(
  turn: QueuedTerminalSkillTurn,
): Promise<
  | { status: "observed"; entries: Record<string, unknown>[] }
  | { status: "unavailable" | "truncated" }
> {
  const { start, end } = turn;
  if (
    start === null ||
    end === null ||
    start.path !== end.path ||
    start.device !== end.device ||
    start.inode !== end.inode ||
    end.offset < start.offset
  )
    return { status: "unavailable" };
  try {
    const handle = await openProviderTranscript(turn.provider, start.path);
    try {
      const metadata = await handle.stat({ bigint: true });
      if (
        !metadata.isFile() ||
        String(metadata.dev) !== start.device ||
        String(metadata.ino) !== start.inode ||
        metadata.size < BigInt(end.offset) ||
        !(await prefixesIntact(handle, start, end))
      )
        return { status: "unavailable" };
      if (turn.provider === "codex") {
        const prefix = Buffer.alloc(Math.min(4096, end.offset));
        const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
        const first = JSON.parse(
          prefix.subarray(0, bytesRead).toString("utf8").split("\n")[0]!,
        ) as { type?: string; payload?: { id?: string } };
        if (
          first.type !== "session_meta" ||
          typeof first.payload?.id !== "string" ||
          sha256(`codex\0${first.payload.id}`) !== turn.providerSessionDigest
        )
          return { status: "unavailable" };
      }
      const length = end.offset - start.offset;
      if (length > MAXIMUM_SKILL_TRANSCRIPT_BYTES) return { status: "truncated" };
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const result = await handle.read(bytes, read, length - read, start.offset + read);
        if (result.bytesRead === 0) return { status: "unavailable" };
        read += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (after.size < BigInt(end.offset) || !(await prefixesIntact(handle, start, end)))
        return { status: "unavailable" };
      const entries: Record<string, unknown>[] = [];
      for (const line of bytes.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        const entry = JSON.parse(line) as Record<string, unknown>;
        // Claude file-history records carry no session and no tool use; they are not turn content.
        if (turn.provider === "claude" && CLAUDE_FILE_HISTORY.has(entry?.type as string)) continue;
        if (
          turn.provider === "claude" &&
          (typeof entry?.sessionId !== "string" ||
            sha256(`${turn.provider}\0${entry.sessionId}`) !== turn.providerSessionDigest)
        )
          return { status: "unavailable" };
        entries.push(entry);
      }
      return { status: "observed", entries };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unavailable" };
  }
}

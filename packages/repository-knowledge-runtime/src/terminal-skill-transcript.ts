import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { QueuedTerminalSkillTurn } from "./terminal-skill-queue.js";
import { transcriptSkillIdentifiers } from "./terminal-skill-transcript-adapters.js";

export const MAXIMUM_SKILL_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
export type SkillTranscriptAssessment = {
  skillTelemetry: "observed" | "unavailable" | "truncated";
  identifiers: string[];
};
const unavailable = (): SkillTranscriptAssessment => ({
  skillTelemetry: "unavailable",
  identifiers: [],
});

/** Reads the recorded range once in the resident, without retaining transcript or tool content. */
export async function assessTerminalSkillTranscript(
  turn: QueuedTerminalSkillTurn,
): Promise<SkillTranscriptAssessment> {
  const { start, end } = turn;
  if (
    start === null ||
    end === null ||
    start.path !== end.path ||
    start.device !== end.device ||
    start.inode !== end.inode ||
    end.offset < start.offset
  )
    return unavailable();
  try {
    const handle = await open(
      start.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
    );
    try {
      const metadata = await handle.stat({ bigint: true });
      if (
        !metadata.isFile() ||
        String(metadata.dev) !== start.device ||
        String(metadata.ino) !== start.inode ||
        metadata.size < BigInt(end.offset)
      )
        return unavailable();
      const length = end.offset - start.offset;
      if (length > MAXIMUM_SKILL_TRANSCRIPT_BYTES)
        return { skillTelemetry: "truncated", identifiers: [] };
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const result = await handle.read(bytes, read, length - read, start.offset + read);
        if (result.bytesRead === 0) return unavailable();
        read += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (after.size < BigInt(end.offset)) return unavailable();
      const identifiers: string[] = [];
      for (const line of bytes.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        identifiers.push(...transcriptSkillIdentifiers(turn.provider, JSON.parse(line)));
      }
      return { skillTelemetry: "observed", identifiers };
    } finally {
      await handle.close();
    }
  } catch {
    return unavailable();
  }
}

import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAXIMUM_PROJECT_DIRECTORIES = 512;
const MAXIMUM_TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

interface ClaudeTranscriptRow {
  type?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  isSidechain?: unknown;
  message?: {
    stop_reason?: unknown;
    content?: unknown;
  };
}

export async function readClaudeSessionFinal(input: {
  sessionId: string;
  repositoryRoot: string;
  startedAtMs: number;
  completedAtMs: number;
  configDirectory?: string;
}): Promise<string | null> {
  const projectsRoot = join(
    input.configDirectory ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    "projects",
  );
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const canonicalCwds = new Map<string, string | null>();
  if (entries.length > MAXIMUM_PROJECT_DIRECTORIES) return null;
  let repositoryPath: string;
  try {
    repositoryPath = await realpath(input.repositoryRoot);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcriptPath = join(projectsRoot, entry.name, `${input.sessionId}.jsonl`);
    let file;
    try {
      file = await open(transcriptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await file.stat();
      if (!metadata.isFile()) continue;
      const start = Math.max(0, metadata.size - MAXIMUM_TRANSCRIPT_TAIL_BYTES);
      const bytes = Buffer.alloc(metadata.size - start);
      let readBytes = 0;
      while (readBytes < bytes.length) {
        const { bytesRead } = await file.read(
          bytes,
          readBytes,
          bytes.length - readBytes,
          start + readBytes,
        );
        if (bytesRead === 0) break;
        readBytes += bytesRead;
      }
      const lines = bytes.subarray(0, readBytes).toString("utf8").split("\n");
      if (start > 0) lines.shift();
      let finalText: string | null = null;
      for (const line of lines) {
        let row: ClaudeTranscriptRow;
        try {
          row = JSON.parse(line) as ClaudeTranscriptRow;
        } catch {
          continue;
        }
        if (
          row.sessionId !== input.sessionId ||
          typeof row.cwd !== "string" ||
          row.isSidechain === true ||
          typeof row.timestamp !== "string"
        ) {
          continue;
        }
        const timestamp = Date.parse(row.timestamp);
        if (
          !Number.isFinite(timestamp) ||
          timestamp < input.startedAtMs ||
          timestamp > input.completedAtMs
        ) {
          continue;
        }
        let canonicalCwd = canonicalCwds.get(row.cwd);
        if (canonicalCwd === undefined) {
          canonicalCwd = await realpath(row.cwd).catch(() => null);
          canonicalCwds.set(row.cwd, canonicalCwd);
        }
        if (canonicalCwd !== repositoryPath) continue;
        if (row.type === "user") {
          const content = (row.message as { content?: unknown } | undefined)?.content;
          if (!Array.isArray(content) || !content.every((block) => block?.type === "tool_result")) {
            finalText = null;
          }
        }
        if (row.type !== "assistant") continue;
        const content = row.message?.content;
        if (!Array.isArray(content) || content.some((block) => block?.type === "tool_use")) {
          finalText = null;
          continue;
        }
        if (row.message?.stop_reason !== "end_turn") continue;
        const text = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text as string)
          .join("\n")
          .trim();
        finalText = text.length === 0 ? null : text;
      }
      return finalText;
    } catch {
      // A missing or unreadable provider transcript cannot be used as result evidence.
    } finally {
      await file?.close();
    }
  }
  return null;
}

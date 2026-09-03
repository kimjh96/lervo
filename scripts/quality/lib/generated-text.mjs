import { readFile, writeFile } from "node:fs/promises";

export function normalizeGeneratedText(content) {
  return content.replaceAll("\r\n", "\n");
}

export async function normalizeGeneratedTextFile(path) {
  const content = await readFile(path, "utf8");
  const normalized = normalizeGeneratedText(content);
  if (normalized !== content) await writeFile(path, normalized, "utf8");
}

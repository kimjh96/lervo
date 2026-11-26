import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export const GENERATED_DURABLE_INSTRUCTION_DIRECTORY = "docs/instructions/generated";
const RULE_FILE = /^rule_[a-f0-9]{24}\.md$/u;
const MAXIMUM_LISTED = 16;
const MAXIMUM_RULE_BYTES = 8 * 1024;

export interface GeneratedDurableInstruction {
  ruleId: string;
  path: string;
  title: string;
}

function title(content: string): string | null {
  const lines = content.split("\n");
  let index = 0;
  if (lines[0] === "---") {
    index = lines.indexOf("---", 1);
    if (index < 0) return null;
    index += 1;
  }
  const heading = lines.slice(index).find((line) => line.startsWith("# "));
  return heading === undefined ? null : heading.slice(2).trim() || null;
}

async function boundedRead(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAXIMUM_RULE_BYTES) return null;
    return (await handle.readFile()).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Lists applied Lervo-generated owner rules, sorted and bounded, for surfaces that must show every
 * provider the same rules. Unreadable or malformed files are skipped rather than guessed at.
 */
export async function listGeneratedDurableInstructions(
  repositoryRoot: string,
): Promise<{ rules: GeneratedDurableInstruction[]; totalCount: number }> {
  let names: string[];
  try {
    names = (await readdir(resolve(repositoryRoot, GENERATED_DURABLE_INSTRUCTION_DIRECTORY)))
      .filter((name) => RULE_FILE.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { rules: [], totalCount: 0 };
    throw error;
  }
  // Read together, in name order: every prompt lists these.
  const listed = await Promise.all(
    names.slice(0, MAXIMUM_LISTED).map(async (name) => {
      const path = `${GENERATED_DURABLE_INSTRUCTION_DIRECTORY}/${name}`;
      const content = await boundedRead(resolve(repositoryRoot, path));
      const ruleTitle = content === null ? null : title(content);
      return ruleTitle === null
        ? null
        : { ruleId: name.slice(0, -".md".length), path, title: ruleTitle };
    }),
  );
  const rules = listed.filter((rule): rule is GeneratedDurableInstruction => rule !== null);
  return { rules, totalCount: names.length };
}

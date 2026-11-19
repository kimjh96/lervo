const wordPattern = /^[a-z][a-z0-9-]*$/u;

/**
 * The CLI command catalog in a usage text: for every line that starts with `lervo`, the leading
 * lowercase command words before the first flag, placeholder, or option group (ADR-0562).
 */
export function cliCommandCatalog(usage: string): string[] {
  const commands = new Set<string>();
  for (const line of usage.split("\n")) {
    const words = line.trim().split(/\s+/u);
    if (words[0] !== "lervo") continue;
    const command = ["lervo"];
    for (const word of words.slice(1)) {
      if (!wordPattern.test(word)) break;
      command.push(word);
    }
    if (command.length > 1) commands.add(command.join(" "));
  }
  return [...commands].sort();
}

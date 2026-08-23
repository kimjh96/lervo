export function buildClaudeManagedTurnMessage(
  repositoryRoot: string,
  instructions: string,
): string {
  return [
    "[Lervo managed execution boundary]",
    `Repository root: ${JSON.stringify(repositoryRoot)}`,
    "Resolve every repository-relative path against this exact root.",
    "Write/Edit file_path values must remain inside this root.",
    "",
    instructions,
  ].join("\n");
}

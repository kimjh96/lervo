/**
 * One POSIX shell word, quoted only when it needs it, so a printed command can be pasted as is.
 * The macOS state directory sits under `Application Support`, and repository roots can hold
 * spaces or non-ASCII names; plain identifiers stay unquoted.
 */
export function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

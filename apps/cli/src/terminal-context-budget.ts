/**
 * Hard byte budgets for prompt-time context injected through terminal hooks. The compact budget
 * leaves room for the roughly 2 KiB synchronous turn-declaration contract that applies while no
 * background knowledge owner is healthy; without it, compact context stays well under 2 KiB.
 */
export const MAXIMUM_COMPACT_CONTEXT_BYTES = 4 * 1024;
export const MAXIMUM_TERMINAL_ATTENTION_BYTES = 4 * 1024;

function truncationMarker(maximumBytes: number): string {
  return `\n[Lervo context truncated at ${maximumBytes} bytes; inspect \`lervo workstream current\` and \`lervo application attention --json\`.]`;
}

function utf8Prefix(value: string, maximumBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

/**
 * Caps text at an exact UTF-8 byte budget. Truncation is deterministic: the longest whole-character
 * prefix that leaves room for a marker naming the budget and where the omitted content lives.
 */
export function capContextBytes(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  const marker = truncationMarker(maximumBytes);
  if (Buffer.byteLength(marker) > maximumBytes) return utf8Prefix(value, maximumBytes);
  return `${utf8Prefix(value, maximumBytes - Buffer.byteLength(marker))}${marker}`;
}

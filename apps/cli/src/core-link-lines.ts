// The core link's input framing: one JSON request per line, with each line bounded so a session
// host that sends too much ends the link instead of growing memory (core-link protocol).
/** Bytes in one request line. A `decoder.output` request carries at most 1 MiB as Base64. */
export const MAX_REQUEST_LINE_BYTES = 2 * 1024 * 1024;

/**
 * Splits the input into lines without holding more than one bounded line. A line over the bound
 * yields `null`, which ends the link.
 */
export async function* lines(
  input: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<string | null> {
  const decoder = new TextDecoder();
  let partial = "";
  for await (const chunk of input) {
    partial += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let end = partial.indexOf("\n");
    while (end !== -1) {
      yield partial.slice(0, end);
      partial = partial.slice(end + 1);
      end = partial.indexOf("\n");
    }
    if (partial.length > MAX_REQUEST_LINE_BYTES) {
      yield null;
      return;
    }
  }
}

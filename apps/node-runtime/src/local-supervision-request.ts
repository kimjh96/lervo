import { createHash } from "node:crypto";

/** Reads one private local goal from stdin without exposing its text in process arguments. */
export async function readLocalSupervisionRequest(
  input: AsyncIterable<Uint8Array | string>,
): Promise<{ sourceId: string; requesterId: string; request: string; contentHash: string }> {
  const chunks: Uint8Array[] = [];
  let count = 0;
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    count += bytes.byteLength;
    if (count > 16_384) throw new Error("The local supervised request exceeds its byte bound.");
    chunks.push(bytes);
  }
  const request = new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks));
  if (request.trim().length === 0 || request.includes("\0"))
    throw new Error("The local supervised request is empty or invalid.");
  const contentHash = `sha256:${createHash("sha256").update(request).digest("hex")}`;
  return {
    sourceId: contentHash,
    requesterId: "local_process_owner",
    request,
    contentHash,
  };
}

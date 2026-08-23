const MAX_TRANSPORT_RESPONSE_BYTES = 16_777_216;

export function resolveRemoteCommandHttpResponseLimit(value: number | undefined): number {
  const resolved = value ?? 1_048_576;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAX_TRANSPORT_RESPONSE_BYTES) {
    throw new Error("The remote command HTTP transport response limit is invalid.");
  }
  return resolved;
}

export async function readRemoteCommandHttpJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maxBytes)
  ) throw new Error("The remote command Hub response size is invalid.");
  if (response.body === null) throw new Error("The remote command Hub response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteCount += item.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error("The remote command Hub response exceeds the allowed size.");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The remote command Hub response is not UTF-8 JSON.");
  }
}

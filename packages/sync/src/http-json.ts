const utf8 = new TextDecoder("utf-8", { fatal: true });

export async function readSyncHttpJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maximumBytes))
    throw new Error("The Hub synchronization response size is invalid.");
  if (response.body === null) throw new Error("The Hub synchronization response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteCount += item.value.byteLength;
    if (byteCount > maximumBytes) {
      await reader.cancel();
      throw new Error("The Hub synchronization response exceeds the allowed size.");
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
    return JSON.parse(utf8.decode(bytes));
  } catch (error) {
    throw new Error("The Hub synchronization response is not UTF-8 JSON.", { cause: error });
  }
}

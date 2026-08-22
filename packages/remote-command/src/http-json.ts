const MAX_TRANSPORT_RESPONSE_BYTES = 16_777_216;

export function resolveRemoteCommandHttpResponseLimit(value: number | undefined): number {
  const resolved = value ?? 1_048_576;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAX_TRANSPORT_RESPONSE_BYTES) {
    throw new Error("Remote command HTTP transport 응답 한도가 유효하지 않습니다.");
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
  ) throw new Error("Remote command Hub 응답 크기가 유효하지 않습니다.");
  if (response.body === null) throw new Error("Remote command Hub 응답 본문이 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteCount += item.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error("Remote command Hub 응답이 허용 크기를 넘었습니다.");
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
    throw new Error("Remote command Hub 응답이 UTF-8 JSON이 아닙니다.");
  }
}

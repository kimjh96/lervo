import { createHash, type Hash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
/** A blob larger than this reads as absent, exactly as the former per-path read's output bound. */
const MAXIMUM_BLOB_BYTES = 64 * 1024 * 1024;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
/**
 * `cat-file --batch` reads one request per line and drops a CR before the LF, so a name with a
 * line break would be read differently. Every control character takes the separate read instead.
 */
const NOT_A_BATCH_LINE = /[\x00-\x1f\x7f]/u;

interface BatchAnswer {
  objectId: string | null;
  /** The blob's SHA-256; `null` for anything other than a blob within the output bound. */
  hash: string | null;
}

/**
 * One interactive `git cat-file --batch`: Git flushes each answer, so a later request can depend
 * on an earlier one. Blob bodies are hashed as they stream and never buffered whole. A failed
 * process answers every outstanding and later request as absent.
 */
function openObjectBatch(root: string) {
  const child = spawn("git", ["-C", root, "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const waiting: ((answer: BatchAnswer) => void)[] = [];
  let failed = false;
  let pending: Buffer = Buffer.alloc(0);
  let body: { remaining: number; hash: Hash | null; objectId: string } | null = null;
  const answer = (value: BatchAnswer) => waiting.shift()?.(value);
  const fail = () => {
    failed = true;
    while (waiting.length > 0) answer({ objectId: null, hash: null });
  };
  const consume = () => {
    for (;;) {
      if (body !== null) {
        const take = Math.min(body.remaining, pending.byteLength);
        body.hash?.update(pending.subarray(0, take));
        pending = pending.subarray(take);
        body.remaining -= take;
        // The body is followed by one line feed.
        if (body.remaining > 0 || pending.byteLength === 0) return;
        pending = pending.subarray(1);
        answer({
          objectId: body.objectId,
          hash: body.hash === null ? null : `sha256:${body.hash.digest("hex")}`,
        });
        body = null;
        continue;
      }
      const end = pending.indexOf(0x0a);
      if (end < 0) return;
      const header = pending.subarray(0, end).toString("utf8").split(" ");
      pending = pending.subarray(end + 1);
      const size = Number(header[2]);
      // `<object> missing` and `<object> ambiguous` name the request, which may contain spaces.
      if (header.length === 3 && OBJECT_ID.test(header[0]!) && Number.isSafeInteger(size)) {
        const blob = header[1] === "blob" && size <= MAXIMUM_BLOB_BYTES;
        body = { remaining: size, hash: blob ? createHash("sha256") : null, objectId: header[0]! };
      } else answer({ objectId: null, hash: null });
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    pending = pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk]);
    consume();
  });
  child.stdin.on("error", () => undefined);
  child.on("error", fail);
  child.on("close", fail);
  return {
    request(name: string): Promise<BatchAnswer> {
      if (failed) return Promise.resolve({ objectId: null, hash: null });
      return new Promise((resolveAnswer) => {
        waiting.push(resolveAnswer);
        child.stdin.write(`${name}\n`);
      });
    },
    close: () =>
      new Promise<void>((closed) => {
        if (child.exitCode !== null || child.signalCode !== null) closed();
        else child.once("close", () => closed());
        child.stdin.end();
      }),
  };
}

/** One `cat-file blob`, for a name that a `--batch` request line cannot carry verbatim. */
async function singleBlobHash(root: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", name], {
      encoding: "buffer",
      maxBuffer: MAXIMUM_BLOB_BYTES,
    });
    return `sha256:${createHash("sha256").update(stdout).digest("hex")}`;
  } catch {
    return null;
  }
}

/**
 * The SHA-256 of each path's committed bytes at `revision`, or `null` where it has no such blob:
 * each answer equals one `git cat-file blob <revision>:<path>`. `revision` resolves to its tree
 * once, so every path is read from the same tree through one Git process. Nothing is remembered
 * between calls, so a repository that can no longer answer is never answered from an earlier read.
 */
export async function committedBlobHashes(
  root: string,
  revision: string,
  paths: readonly string[],
): Promise<Map<string, string | null>> {
  const hashes = new Map<string, string | null>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return hashes;
  if (NOT_A_BATCH_LINE.test(revision)) {
    for (const path of unique) hashes.set(path, await singleBlobHash(root, `${revision}:${path}`));
    return hashes;
  }
  const batch = openObjectBatch(root);
  try {
    const tree = (await batch.request(`${revision}^{tree}`)).objectId;
    // Requests are pipelined; Git answers them in order.
    const answers = await Promise.all(
      unique.map((path) =>
        tree === null
          ? null
          : NOT_A_BATCH_LINE.test(path)
            ? singleBlobHash(root, `${tree}:${path}`)
            : batch.request(`${tree}:${path}`).then((answer) => answer.hash),
      ),
    );
    unique.forEach((path, index) => hashes.set(path, answers[index]!));
  } finally {
    await batch.close();
  }
  return hashes;
}

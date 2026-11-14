import { createHash, type Hash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
/** A blob larger than this reads as absent, exactly as the former per-path read's output bound. */
const MAXIMUM_BLOB_BYTES = 64 * 1024 * 1024;
const MAXIMUM_REMEMBERED = 4_096;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/**
 * Object identities fix their content, so a commit's tree and a tree path's blob hash stay valid
 * for the process lifetime. Absent answers are not remembered: in a partial clone, a missing
 * object can arrive later.
 */
const rememberedTrees = new Map<string, string>();
const rememberedHashes = new Map<string, string>();

function remember(map: Map<string, string>, key: string, value: string): void {
  if (map.size >= MAXIMUM_REMEMBERED) map.clear();
  map.set(key, value);
}

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

/** One `cat-file blob`, for a path that a `--batch` request line cannot carry. */
async function singleBlobHash(root: string, tree: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `${tree}:${path}`], {
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
 * once, so every path is read from the same tree, through at most one Git process; a known object
 * identity whose answers are all remembered starts none.
 */
export async function committedBlobHashes(
  root: string,
  revision: string,
  paths: readonly string[],
): Promise<Map<string, string | null>> {
  const hashes = new Map<string, string | null>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return hashes;
  const knownTree = OBJECT_ID.test(revision)
    ? rememberedTrees.get(`${root}\0${revision}`)
    : undefined;
  const key = (tree: string, path: string) => `${root}\0${tree}\0${path}`;
  if (
    knownTree !== undefined &&
    unique.every((path) => rememberedHashes.has(key(knownTree, path)))
  ) {
    for (const path of unique) hashes.set(path, rememberedHashes.get(key(knownTree, path))!);
    return hashes;
  }
  const batch = openObjectBatch(root);
  try {
    const tree = knownTree ?? (await batch.request(`${revision}^{tree}`)).objectId;
    if (tree === null) {
      for (const path of unique) hashes.set(path, null);
      return hashes;
    }
    if (OBJECT_ID.test(revision)) remember(rememberedTrees, `${root}\0${revision}`, tree);
    // Requests are pipelined; Git answers them in order.
    const answers = await Promise.all(
      unique.map((path) => {
        const known = rememberedHashes.get(key(tree, path));
        if (known !== undefined) return known;
        if (path.includes("\n")) return singleBlobHash(root, tree, path);
        return batch.request(`${tree}:${path}`).then((answer) => answer.hash);
      }),
    );
    unique.forEach((path, index) => {
      const hash = answers[index]!;
      if (hash !== null) remember(rememberedHashes, key(tree, path), hash);
      hashes.set(path, hash);
    });
  } finally {
    await batch.close();
  }
  return hashes;
}

import { gzipSync } from "node:zlib";

function writeField(header, offset, length, value) {
  header.write(value.slice(0, length), offset, length, "utf8");
}

function octalField(value, digits) {
  return `${value.toString(8).padStart(digits, "0")}\0`;
}

/**
 * Writes a minimal ustar npm package tarball. Each entry is `{ path, contents, type }`, where
 * `path` already includes any `package/` prefix and `type` defaults to a regular file.
 */
export function createNpmTarball(entries) {
  const blocks = [];
  for (const { path, contents = Buffer.alloc(0), type = "0" } of entries) {
    const header = Buffer.alloc(512);
    writeField(header, 0, 100, path);
    writeField(header, 100, 8, "0000644\0");
    writeField(header, 108, 8, "0000000\0");
    writeField(header, 116, 8, "0000000\0");
    writeField(header, 124, 12, octalField(contents.length, 11));
    writeField(header, 136, 12, octalField(499_162_500, 11));
    writeField(header, 148, 8, "        ");
    writeField(header, 156, 1, type);
    writeField(header, 257, 6, "ustar\0");
    writeField(header, 263, 2, "00");
    let sum = 0;
    for (const byte of header) sum += byte;
    writeField(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

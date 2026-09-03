import { deflateRawSync } from "node:zlib";

function crc32(contents) {
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader({ name, contents, compressed, crc, offset, descriptor }) {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(descriptor ? 0x0808 : 0x0800, 6);
  header.writeUInt16LE(8, 8);
  if (!descriptor) {
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(contents.length, 22);
  }
  header.writeUInt16LE(nameBytes.length, 26);
  const dataDescriptor = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (descriptor) {
    dataDescriptor.writeUInt32LE(0x08074b50, 0);
    dataDescriptor.writeUInt32LE(crc, 4);
    dataDescriptor.writeUInt32LE(compressed.length, 8);
    dataDescriptor.writeUInt32LE(contents.length, 12);
  }
  return {
    bytes: Buffer.concat([header, nameBytes, compressed, dataDescriptor]),
    central: { nameBytes, contents, compressed, crc, offset, descriptor },
  };
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(entry.descriptor ? 0x0808 : 0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.contents.length, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.nameBytes]);
}

export function createZipArchive(entries, { descriptor = false } = {}) {
  const localParts = [];
  const centralEntries = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const contents = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const compressed = deflateRawSync(contents);
    const entry = localHeader({
      name,
      contents,
      compressed,
      crc: crc32(contents),
      offset,
      descriptor,
    });
    localParts.push(entry.bytes);
    centralEntries.push(entry.central);
    offset += entry.bytes.length;
  }
  const central = Buffer.concat(centralEntries.map(centralHeader));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

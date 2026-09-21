import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export type ZipEntry = { name: string; path?: string; bytes?: Buffer };
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(crc: number, bytes: Buffer) { for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }

// Stored ZIP entries stream existing MP4s with constant memory; videos are already compressed.
// ZIP32 is deliberately capped before writing headers so no corrupt >4 GB archive is offered.
export async function zipStream(entries: ZipEntry[], signal: AbortSignal) {
  let total = 0;
  if (!entries.length || entries.length > 500) throw Error("INVALID_INPUT");
  const sizes: number[] = [];
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name)) throw Error("INVALID_INPUT");
    const size = entry.path ? (await stat(entry.path)).size : entry.bytes!.length;
    sizes.push(size); total += size + 128 + entry.name.length * 2;
  }
  if (total > 3 * 1024 ** 3) throw Error("ARCHIVE_TOO_LARGE");
  async function* writeZip() {
    let offset = 0; const central: Buffer[] = [];
    for (const [index, entry] of entries.entries()) {
      if (signal.aborted) return;
      const name = Buffer.from(entry.name), start = offset;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 6); header.writeUInt16LE(33, 12); header.writeUInt16LE(name.length, 26);
      yield header; yield name; offset += header.length + name.length;
      let crc = 0xffffffff, size = 0;
      const stream = entry.path ? createReadStream(entry.path, { signal }) : Readable.from([entry.bytes!]);
      try { for await (const chunk of stream) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > sizes[index]) throw Error("MEDIA_CHANGED"); crc = crc32(crc, bytes); yield bytes; offset += bytes.length; } }
      finally { stream.destroy(); }
      if (size !== sizes[index]) throw Error("MEDIA_CHANGED");
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12);
      yield descriptor; offset += 16;
      const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 8); record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16); record.writeUInt32LE(size, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(start, 42);
      central.push(Buffer.concat([record, name]));
    }
    const centralStart = offset;
    for (const record of central) { yield record; offset += record.length; }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(offset - centralStart, 12); end.writeUInt32LE(centralStart, 16); yield end;
  }
  return Readable.toWeb(Readable.from(writeZip())) as ReadableStream;
}

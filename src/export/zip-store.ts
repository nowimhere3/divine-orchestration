/** ZIP32 STORE writer. File names and contents are encoded as UTF-8 by callers. */
export interface ArchiveFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const UTF8_FLAG = 0x0800;
const DOS_EPOCH_DATE = 0x0021;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = MAX_UINT32;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ MAX_UINT32) >>> 0;
}

export function createStoreZip(files: readonly ArchiveFile[]): Uint8Array<ArrayBuffer> {
  if (files.length >= MAX_UINT16) throw new RangeError('Too many files for a ZIP32 research archive.');
  const encoder = new TextEncoder();
  const names = new Set<string>();
  let directoryOffset = 0;
  let directorySize = 0;
  const entries = files.map(file => {
    const name = encoder.encode(file.name);
    if (!name.length || names.has(file.name) || /[\\/:\u0000-\u001f]/.test(file.name) ||
        file.name === '.' || file.name === '..' || name.length > MAX_UINT16) {
      throw new TypeError('ZIP research files need unique, safe base names.');
    }
    names.add(file.name);
    const offset = directoryOffset;
    directoryOffset += 30 + name.length + file.bytes.length;
    directorySize += 46 + name.length;
    return { name, bytes: file.bytes, offset, crc: crc32(file.bytes) };
  });
  const totalSize = directoryOffset + directorySize + 22;
  if (totalSize >= MAX_UINT32) throw new RangeError('Research archive exceeds the ZIP32 size limit.');
  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let directory = directoryOffset;
  for (const { name, bytes, offset, crc } of entries) {
    u32(offset, 0x04034b50);
    u16(offset + 4, 20);
    u16(offset + 6, UTF8_FLAG);
    u16(offset + 12, DOS_EPOCH_DATE);
    u32(offset + 14, crc);
    u32(offset + 18, bytes.length);
    u32(offset + 22, bytes.length);
    u16(offset + 26, name.length);
    result.set(name, offset + 30);
    result.set(bytes, offset + 30 + name.length);

    u32(directory, 0x02014b50);
    u16(directory + 4, 20);
    u16(directory + 6, 20);
    u16(directory + 8, UTF8_FLAG);
    u16(directory + 14, DOS_EPOCH_DATE);
    u32(directory + 16, crc);
    u32(directory + 20, bytes.length);
    u32(directory + 24, bytes.length);
    u16(directory + 28, name.length);
    u32(directory + 42, offset);
    result.set(name, directory + 46);
    directory += 46 + name.length;
  }
  u32(directory, 0x06054b50);
  u16(directory + 8, entries.length);
  u16(directory + 10, entries.length);
  u32(directory + 12, directorySize);
  u32(directory + 16, directoryOffset);
  return result;
}

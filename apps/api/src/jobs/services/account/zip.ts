// biome-ignore-all lint/suspicious/noBitwiseOperators: CRC-32 and the ZIP binary layout are bit arithmetic.
// A small dependency-free ZIP writer for the account export (11 §10).
//
// Entries are STORED (no compression: most exported files are PDFs and
// images that are compressed already) with UTF-8 names and their CRC-32
// computed up front, so no data descriptors are needed. Output goes to a
// `ZipSink`; `R2ZipSink` writes it to R2 with ONE put when it stays small
// and as a multipart upload (equal-size parts, R2's rule) when it grows past
// one part, so memory stays bounded by a part plus the current entry.
// Limits (no ZIP64): < 65,535 entries and < 4 GiB in total.

const LOCAL_HEADER = 0x04_03_4b_50;
const CENTRAL_HEADER = 0x02_01_4b_50;
const END_OF_CENTRAL = 0x06_05_4b_50;
const UTF8_FLAG = 0x08_00;
const VERSION = 20;
const VERSION_MADE_BY = (3 << 8) | VERSION; // Unix, 2.0
const FILE_MODE = 0o10_0644;
const MAX_ENTRIES = 0xff_ff;
const MAX_OFFSET = 0xff_ff_ff_ff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>;
}

interface CentralEntry {
  crc: number;
  name: Uint8Array;
  offset: number;
  size: number;
}

const encoder = new TextEncoder();

export class ZipWriter {
  readonly #entries: CentralEntry[] = [];
  readonly #names = new Set<string>();
  readonly #sink: ZipSink;
  readonly #stamp: { date: number; time: number };
  #offset = 0;

  constructor(sink: ZipSink, modified: Date) {
    this.#sink = sink;
    this.#stamp = dosDateTime(modified);
  }

  get entries(): number {
    return this.#entries.length;
  }

  get bytes(): number {
    return this.#offset;
  }

  /** Appends one stored file. Names are unique ("a/b.json"). */
  async addFile(name: string, data: Uint8Array | string): Promise<void> {
    if (this.#names.has(name)) {
      throw new Error(`duplicate zip entry ${name}`);
    }
    if (this.#entries.length >= MAX_ENTRIES) {
      throw new Error("too many zip entries (no ZIP64)");
    }
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const nameBytes = encoder.encode(name);
    if (this.#offset + 30 + nameBytes.length + bytes.length > MAX_OFFSET) {
      throw new Error("zip larger than 4 GiB (no ZIP64)");
    }
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, this.#stamp.time, true);
    view.setUint16(12, this.#stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    this.#names.add(name);
    this.#entries.push({
      name: nameBytes,
      crc,
      size: bytes.length,
      offset: this.#offset,
    });
    await this.#sink.write(header);
    await this.#sink.write(bytes);
    this.#offset += header.length + bytes.length;
  }

  /** Writes the central directory and the end record. */
  async finish(): Promise<{ bytes: number; entries: number }> {
    const start = this.#offset;
    let size = 0;
    for (const entry of this.#entries) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, CENTRAL_HEADER, true);
      view.setUint16(4, VERSION_MADE_BY, true);
      view.setUint16(6, VERSION, true);
      view.setUint16(8, UTF8_FLAG, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, this.#stamp.time, true);
      view.setUint16(14, this.#stamp.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, (FILE_MODE << 16) >>> 0, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      await this.#sink.write(record);
      size += record.length;
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, END_OF_CENTRAL, true);
    view.setUint16(8, this.#entries.length, true);
    view.setUint16(10, this.#entries.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, start, true);
    await this.#sink.write(end);
    this.#offset += size + end.length;
    return { bytes: this.#offset, entries: this.#entries.length };
  }
}

/** Default multipart part size (R2: ≥ 5 MiB, equal sizes but the last). */
export const ZIP_PART_SIZE = 8 * 1024 * 1024;

/**
 * Streams a zip into R2: buffered and written with one `put` while it fits
 * in one part, switched to a multipart upload as soon as it does not.
 */
export class R2ZipSink implements ZipSink {
  readonly #bucket: R2Bucket;
  readonly #key: string;
  readonly #options: R2PutOptions & R2MultipartOptions;
  readonly #partSize: number;
  readonly #parts: R2UploadedPart[] = [];
  #chunks: Uint8Array[] = [];
  #buffered = 0;
  #upload: R2MultipartUpload | null = null;

  constructor(
    bucket: R2Bucket,
    key: string,
    options: R2PutOptions & R2MultipartOptions = {},
    partSize: number = ZIP_PART_SIZE
  ) {
    this.#bucket = bucket;
    this.#key = key;
    this.#options = options;
    this.#partSize = partSize;
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.#chunks.push(chunk);
    this.#buffered += chunk.length;
    while (this.#buffered >= this.#partSize) {
      await this.#uploadPart(this.#take(this.#partSize));
    }
  }

  /** Joins and removes the first `size` buffered bytes. */
  #take(size: number): Uint8Array {
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      const head = this.#chunks[0];
      const need = size - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.#chunks.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.#chunks[0] = head.subarray(need);
        filled += need;
      }
    }
    this.#buffered -= size;
    return out;
  }

  async #uploadPart(bytes: Uint8Array): Promise<void> {
    this.#upload ??= await this.#bucket.createMultipartUpload(
      this.#key,
      this.#options
    );
    const part = await this.#upload.uploadPart(this.#parts.length + 1, bytes);
    this.#parts.push(part);
  }

  /** Completes the object (one put, or the last part + complete). */
  async close(): Promise<void> {
    const rest = this.#take(this.#buffered);
    if (!this.#upload) {
      await this.#bucket.put(this.#key, rest, this.#options);
      return;
    }
    if (rest.length > 0) {
      await this.#uploadPart(rest);
    }
    await this.#upload.complete(this.#parts);
  }

  /** Abandons a multipart upload after a failure (best effort). */
  async abort(): Promise<void> {
    this.#chunks = [];
    this.#buffered = 0;
    if (this.#upload) {
      await this.#upload.abort().catch(() => undefined);
    }
  }
}
